---
title: 双向 DCDC 源码学习复盘：易错点与迁移要点
date: 2026-10-08
categories: [学学笔记]
tags: [DCDC, STM32, DMA, ADC, HRTIM, PI控制]
description: 复盘双向 DCDC 源码学习中的易错点，梳理 VOFA、串口 DMA、ADC、采样处理、HRTIM、PI 与保护状态机的迁移要点。
coverImg: /covers/hardware.svg
---

# 双向 DCDC 源码学习复盘：易错点与迁移要点

整理日期：2026-10-08。来源：本对话训练与同目录“代码问答”对话，结合磁盘源码核对。对象：STM32F334 `MINI_LOOP` 工程；另标明参考工程 `05Buck-Mode-VLoop-PID` 的差异。

范围：VOFA、串口 DMA、ADC、采样处理、HRTIM/PWM、PI、状态机与保护。I²C/OLED 不作为本轮重点。

## 1. VOFA 与串口 DMA

| 易错理解 | 正确结论 |
|---|---|
| `vofa_set_channel()` 负责打包 | 它将数值写入通道数组；打包函数将浮点数据转换为发送帧字节。 |
| DMA 发送函数返回，整帧已进入串口缓存 | 函数成功返回表示传输已启动；DMA 随后逐步读取内存并写入串口，串口继续发送。 |
| 局部数组的问题是其他函数不能访问 | 地址可以传递；真正的问题是函数返回后数组生命周期结束，DMA 可能仍在读取已被复用的栈空间。 |
| `VOFA_SEND_BUSY` 是忙标志位 | 它是返回状态码；`g_vofa_tx_busy` 是模块内的忙状态变量。 |
| 使用 `static` 缓冲区即可安全发送 | 只解决存储生命周期；还必须防止发送期间改写缓冲区。 |

发送流程：

```text
检查忙状态 → 打包 → 置忙 → 启动 DMA
                           ├─ 启动失败：恢复忙状态
                           └─ 发送完成回调：清忙
```

- 忙检查必须在打包之前，避免覆盖正在发送的帧。
- 检查 `HAL_UART_Transmit_DMA()` 返回值，处理 `HAL_BUSY`、`HAL_ERROR`。
- 两个 float 的 JustFloat 帧：8 字节数据 + `00 00 80 7F` 帧尾 = 12 字节。
- 普通 UART DMA 发送需核对 DMA 中断及 USART 最终发送完成中断链路；DMA 搬完不等于最后一位已经离开串口。
- 忙标志卡住时依次检查：启动返回值 → DMA IRQ/HAL 处理 → USART IRQ/HAL 处理 → UART 完成回调 → 模块回调。

命名与作用域：`g_` 是命名习惯；函数外 `static` 变量具有静态存储期、内部链接。`volatile` 不提供互斥，也不保证整组数据一致。

## 2. ADC 与 DMA

| 易错理解 | 正确结论 |
|---|---|
| 四通道全部转换后，DMA 才统一搬运 | 当前配置下，每个通道转换完成后产生 DMA 请求，结果依次进入数组。 |
| DMA 一次只能保证 32 位传输 | 单次传输宽度由配置决定；本工程外设与内存均为半字，即 16 位。 |
| `(uint32_t *)` 会改变 DMA 写入宽度 | 它用于匹配 HAL 参数类型；宽度由 DMA 对齐配置决定，数组仍为 `uint16_t[4]`。 |
| 循环 DMA 会主动不断采样 | ADC 由 HRTIM 触发；循环 DMA 自动恢复传输计数与目标起始位置，等待新的请求。 |
| 连续读取四个数组元素就是同一轮数据 | CPU 读取时 DMA 可能只更新了部分元素，得到新旧轮混合数据。 |

当前映射：

| Rank | 引脚 | 数组元素 | 用途 |
|---|---|---|---|
| 1 | PA0 / ADC1_IN1 | `[0]` | 输入电压 |
| 2 | PA1 / ADC1_IN2 | `[1]` | 输入电流 |
| 3 | PA2 / ADC1_IN3 | `[2]` | 输出电压 |
| 4 | PA3 / ADC1_IN4 | `[3]` | 输出电流 |

- ADC 扫描顺序由 Rank 决定，DMA 按转换顺序填入数组。
- 长度 `4` 表示 4 个 DMA 传输单元；半字配置下共写入 8 字节。
- `ContinuousConvMode = DISABLE`：每轮由外部事件触发，不影响后续重复触发。
- `DMAContinuousRequests` 管理 ADC 后续 DMA 请求；`DMA_CIRCULAR` 管理 DMA 的循环重装，两者职责不同。
- 半传输回调：前两个元素完成；完成回调：四个元素完成。循环传输不会因此锁住数组。

### 整组数据一致性

```text
原数组：[Aₙ, Bₙ, Cₙ, Dₙ]
更新中：[Aₙ₊₁, Bₙ₊₁, Cₙ, Dₙ]
此时读取可能混合两轮数据。
```

可选方案：DMA 原始数组 → 完成回调复制快照 → 主循环在短临界区取走快照 → 临界区外计算和发送。

约束：

1. 回调复制必须在下一轮 DMA 覆盖前完成，需验证中断延迟与采样周期。
2. 取快照时保护“检查就绪、复制、清标志”整个操作，避免回调改写或丢失新通知。
3. 关闭 CPU 中断不会停止 DMA，只能保护由 CPU 回调写入的快照。
4. 单快照仅保留最新组，可能丢弃中间组；每组都要保留时需设计队列并处理溢出。
5. VOFA 可低频读取最新值；PI 与快速保护应有明确执行周期。

### ADC DMA 完成中断链路

```text
NVIC 开启 DMA1_Channel1
→ DMA1_Channel1_IRQHandler()
→ HAL_DMA_IRQHandler(&hdma_adc1)
→ HAL 内部 ADC DMA 回调
→ HAL_ADC_ConvCpltCallback(&hadc1)
```

`HAL_ADC_Start_DMA()` 已关联 HAL 内部 DMA 回调。用户实现 ADC 回调即可，同时必须接通 DMA IRQ。硬件置状态标志，HAL 处理代码清除相关标志，并非全部由硬件自动清除。

## 3. 采样校准与滤波

| 易错理解 | 正确结论 |
|---|---|
| 右移 12 位因为 ADC 是 12 位 | 此处右移消除系数 Q12 的 4096 倍放大；与 ADC 分辨率是独立概念。 |
| 转为 `int32_t` 是为了增加采样精度 | 用于表达负差值并提供乘法数值范围，不增加 ADC 分辨率。 |
| 有电流时才能校准零点 | 应在实际电流为零时测得偏置；有电流会被错误计入零点。 |
| 递归滤波是最近四点算术平均 | 是一阶递归低通，使用上一次滤波状态，历史影响逐步衰减。 |

12 位 ADC：4096 个量化等级，原始码值 0～4095。Q12 系数：整数值约等于实际系数 × 4096，保留有限小数精度。

```c
Vin = ((uint32_t)raw * K >> 12) + B;
Iin = (((int32_t)raw - zero_offset) * K >> 12) + B;
```

- `K` 为校准斜率的定点表示；`B` 与计算结果同尺度。
- `zero_offset` 是零电流对应 ADC 读数，不是物理电流。
- 内部数值不能直接当作伏或安培；单位需查系数、硬件比例及显示换算。
- 例：`raw=2000, K=8192, B=10`，结果为 `4010`。

滤波：

```c
sum = sum + x - (sum >> 2);
y = sum >> 2;
```

忽略整数截断：`y[n] ≈ 3/4·y[n-1] + 1/4·x[n]`。

`sum=0`、连续输入 `1000`：第一次 `sum=1000, y=250`；第二次 `sum=1750, y=437`，不是 875。

- `ADCSample()` 由 TIM3 中断调用，ADC1 由 HRTIM 触发，两者频率不必相同。
- 将负电流截为零会丢失处理后变量中的反向电流信息；双向控制需核对符号处理。

## 4. HRTIM 与 PWM

| 易错理解 | 正确结论 |
|---|---|
| `PERIOD / 时钟` 是 PWM 频率 | 它是周期；频率为有效计数频率除以 PERIOD。 |
| HRTIM 时钟就是系统总线时钟 | 必须核对 HRTIM 时钟源；本工程选择 PLLCLK。 |
| MUL16 只提高分辨率，不影响频率 | 不改变系统时钟，但改变 HRTIM 计数尺度；PERIOD 不变时影响 PWM 频率。 |
| ADC 上升沿指 PWM 引脚上升沿 | 此处指 HRTIM 内部 ADC 触发信号边沿。 |
| 开预装载后写比较值立即生效 | 写入预装载值，在允许的更新事件到来时转入有效寄存器。 |

训练题假设 HRTIM 输入时钟为 64 MHz 时：

```text
fPWM = fHRTIM × 16 / PERIOD
64 MHz × 16 / 10240 = 100 kHz
TPWM = 10 μs
```

**实际 `.ioc` 标注 HRTIM 时钟为 128 MHz，当前配置名义 PWM 为 200 kHz、周期 5 μs。**CPU/HCLK 为 64 MHz，不能把它直接代入 HRTIM 公式。上面的 100 kHz 是训练题条件下的结果，不是本工程参数。等效高分辨率频率不代表 CPU 工作在 GHz。

```c
CMP1 = BuckDuty * PERIOD >> 12;
CMP3 = CMP1 >> 1;
```

`BuckDuty=2048` 表示 50%；`PERIOD=10240` 时，`CMP1=5120, CMP3=2560`。

- 周期事件置位、CMP1 复位：忽略死区与极性时，名义占空比约为 `CMP1/PERIOD`。
- 计数启动、输出使能、更新比较值是三个动作。关闭输出不一定停止计数或 ADC 触发。
- `CMP3=CMP1/2` 位于名义高电平区间中点；考虑死区、极性和驱动延迟后，不等于实际 MOS 导通中点。
- TA2 置位/复位源为 `NONE` 不能直接判定无波形；应结合死区互补路径、输出使能与引脚复用。
- 预装载需核对更新来源、门控及软件更新；本工程配置了重复事件更新，实际生效时序待验证。

## 5. PI 控制

本工程是 Buck 电压 PI，未实现 D 项。

```c
error = reference - measured;
u0 = integral + error * KP;
integral += error * KI;
// 积分限幅
duty = u0 >> 12;
// 输出限幅
```

| 易错理解 | 正确结论 |
|---|---|
| 更新后的积分量是 `1001` | 示例中 `1001` 是占空比控制量，不是积分量。 |
| 只限制输出主要是防 `u0` 超量程 | 还会出现 windup：积分积累，误差反向后输出仍迟迟退出不了饱和。数值溢出是另一问题。 |
| 积分限幅完全解决 windup | 只限制范围，仍可能积累到不适合工况的值。 |
| 上电清零可以解决停机重启 | 普通停机没有复位，静态积分保留；需明确停机与重启策略。 |

计算示例：初始积分 `4096000`，误差 `100`，`KP=50, KI=100`。

```text
u0 = 4101000
新积分 = 4106000
duty = 4101000 >> 12 = 1001
```

- 本次输出使用旧积分，新积分用于下一次。
- P 响应当前误差，I 累积误差并帮助消除持续偏差。
- 相同误差下，调用频率加倍、KI 不变，每秒积分作用约加倍；迁移必须重新核对控制周期。
- 清零 `VErr0`、`u0` 不会清零函数内 `static V_Integral`。
- `PWMENFlag=0` 不会自动停止 PI 或清积分；现有函数仅将最终 Buck 占空比设为最小值。
- 可选抗饱和策略：输出饱和且误差继续推动饱和时停止积分；允许反向退出饱和。启停策略可采用冻结、复位或输出跟踪，需结合工况。

## 6. 状态机与保护

| 易错理解 | 正确结论 |
|---|---|
| 初始化后直接进入 Rise | `Init → Wait`；等待完成、无故障、按键条件满足后才进入 Rise。 |
| 软启动每次固定增加 5 | 当前增量为 `计数器×5`，逐步增大。 |
| `count > 10` 在第 10 次触发 | 从零开始先递增，第 11 次才满足；`>200` 为第 201 次。 |
| 中途条件不满足，计数仍保留 | 当前相关分支明确清零，要求连续满足条件。 |
| 软件关闭标志让程序不动作 | 标志只影响检查它的代码；不等于停止执行或关闭硬件输出。 |

状态路径：

```text
Init → Wait → Rise(SSInit → SSWait → SSRun) → Run
故障 → Err → 全部故障清除后回到 Wait → 再满足启动条件
```

- Wait 累计 256 个电流 ADC 值，除以 256 求零点；进入 Rise 还要求 `CntS>256`、`ErrFlag==F_NOERR`、`KeyFlag1==1`。
- SSInit 关闭输出、设置最小占空比上限；SSWait 等待并设置启动参数；SSRun 开启输出并提高上限。
- 上限初值 80，计数从零开始：前三次为 `85 → 95 → 110`。
- 若每 5 ms 调用，`Cnt>20` 累计 21 次，即 105 ms；仅作为调用周期折算，状态进入相位需另计。

保护要点：

- 过流连续计数 `>10`：11 次；欠压恢复 `>200`：201 次。
- **假设**每 5 ms 调用，分别折算 55 ms、1005 ms；故障到动作的实际延迟还受调用相位影响。
- 超限 8 次 → 正常 1 次 → 超限 3 次：最终计数 3，不触发。
- 同时清软件使能标志与关闭 HRTIM 输出，保持控制意图和硬件状态一致。
- 欠压恢复阈值高于触发阈值，形成滞回；恢复还需连续满足时间条件。
- `ErrFlag &= ~F_SW_VIN_UVP` 仅清欠压位；直接赋零会误清其他故障。
- 仅当全部故障清除，Err 才回到 Wait，不直接进入 Run。
- `Iout` 校准但未经过该平均滤波，响应快、抗噪声较弱；`IoutAvg` 平滑但有延迟。连续越限计数还能筛除短暂异常。

## 7. 当前源码核对与 TODO

2026-10-08 检查结果仅代表当时磁盘源码：

- `Core` 中找到 `BUCKVLoopCtlPI()` 声明和定义，未找到调用，不能据此认定闭环已经运行。
- `UART_DEBUG_ONLY=0`、`ADC_DEBUG_ONLY=1`，主循环处于 ADC 调试发送路径。
- 当前启动使用 `HAL_HRTIM_WaveformCountStart()`；需核对中断是否实际使能，不能仅凭中断配置或 IRQ 函数存在判断执行。
- TIM3 配置 `Prescaler=32, Period=10000`。周期应为 `(32+1)×(10000+1)/fTIM3`；先核对时钟树与 APB 定时器时钟规则，不直接采用“5 ms”注释。

未完成：

- [ ] 核实 PI 实际调用链和执行频率。
- [ ] 整理初始化、采样、控制、保护、通信的执行时序图。
- [ ] 接通 ADC DMA Channel1 完成中断。
- [ ] 实现快照接口并验证数据一致性时间条件。
- [ ] ADC/VOFA 板上验证。
- [ ] PWM、死区、比较值更新时刻的实测验证。
- [ ] 核对软启动计数器及 PI 积分的重启复位策略。
- [ ] 形成可复用模块、最小示例和接口文档；当前未全部验收。

## 8. 迁移检查清单

1. **生命周期**：异步外设使用的缓冲区必须持续有效，完成前不可覆盖。
2. **数据一致性**：单次传输完整不等于整组快照一致；明确生产者、消费者及覆盖时刻。
3. **数值尺度**：记录单位、Q 格式、符号、乘法范围和截断方式。
4. **时间尺度**：从实际时钟和寄存器计算周期；KI、滤波响应、保护计数随调用周期变化。
5. **中断链路**：启动函数、NVIC、IRQ、HAL 处理、用户回调逐层核对。
6. **状态管理**：启停标志、硬件输出、积分状态、计数器和故障位分别管理。
7. **验收边界**：读懂代码、实现接口和硬件验证分别记录，不互相替代。

## 9. 外设使用流程：配置、启动、事件、处理

### 9.1 谁负责什么

全文流程统一使用以下标记：

- **【CubeMX生成】**：你在 CubeMX 选择参数后生成；修改配置优先改 `.ioc` 并重新生成。
- **【你编写】**：启动调用、业务函数、标准回调实现、应用变量管理；放在 USER CODE 区域或独立用户文件。
- **【HAL内部】**：调用 HAL 接口后库内部执行，通常无需改驱动源码。
- **【硬件自动】**：外设按配置运行、产生事件与状态。
- **【CPU响应】**：中断条件满足后进入 IRQ，仍受 NVIC、优先级及屏蔽状态影响。

“生成”描述代码来源，“HAL内部／硬件自动”描述运行责任。生成的 `HAL_DMA_IRQHandler()` 调用也由 CPU 执行，但不需要你重复添加。下述 IRQ 生成以对应 CubeMX NVIC 项已启用为前提；未启用的 ADC DMA Channel1 仍需配置。

| 层次 | 负责内容 | 不会自动替你完成的内容 |
|---|---|---|
| CubeMX | 按你的选择生成时钟、GPIO、外设、DMA、NVIC 初始化 | 决定业务启停、调用控制算法、管理应用状态 |
| HAL 初始化 | 将配置写入外设，建立句柄关联 | 初始化不等于启动采样、计数或传输 |
| HAL 启动接口 | 配置地址与长度、启动硬件、按接口安排中断和内部回调 | 实现你的校准、控制、通信协议 |
| 外设硬件 | 计数、比较、转换、DMA 搬运、串口移位、产生状态标志 | 自动调用任意自定义函数 |
| IRQ/HAL 处理 | 判断事件、处理状态标志、分发回调 | 自动清除你自己的业务标志 |
| 用户代码 | 启动调用、业务回调、数据处理、算法、状态机 | — |

配置成功 → 启动成功 → 硬件事件发生 → CPU 处理，四者分别核对。

### 9.2 句柄与寄存器

```c
HAL_TIM_IRQHandler(&htim3);
HRTIM1->sTimerxRegs[HRTIM_TIMERINDEX_TIMER_A].CMP3xR =
    HRTIM1->sTimerxRegs[HRTIM_TIMERINDEX_TIMER_A].CMP1xR >> 1;
```

- `htim3` 是 HAL 句柄，保存外设实例、配置及驱动状态；`&htim3` 传递其地址。
- `HRTIM1` 是外设寄存器结构体指针；`->` 通过指针访问成员。
- `sTimerxRegs[...]` 选择内部定时器寄存器组；`.CMP3xR` 选择该组中的比较寄存器。
- 右侧读 CMP1 并计算一半，不修改 CMP1；左侧写 CMP3。
- 赋值更新比较位置，不会当场触发 ADC。等待值生效、计数达到 CMP3 后才产生事件。
- CMP1 与 CMP3 没有永久绑定；后续每次修改 CMP1，都需要更新 CMP3 才能维持关系。

## 10. ADC 配置速查与启动顺序

### 10.1 ADC1 配置项

本表全部是 **【CubeMX生成】** 的配置：你在界面设置，生成到 `MX_ADC1_Init()`。PA0～PA3 模拟 GPIO、ADC 时钟及 DMA1_Channel1 参数通常生成在 `HAL_ADC_MspInit()`；DMA 时钟/NVIC 在 `MX_DMA_Init()`。缓冲区定义与启动调用不由这些配置自动生成。

| 配置 | 当前值 | 使用含义／易混点 |
|---|---|---|
| Mode | Independent | ADC1、ADC2 独立；不表示通道同时采样 |
| ClockPrescaler | 同步时钟 ÷4 | 当前 HCLK 64 MHz，对应 ADC 16 MHz |
| Resolution | 12 bit | 0～4095 原始码值 |
| DataAlign | Right | 结果在低位，可存入 `uint16_t` |
| ScanConvMode | Enable | 按 Rank 扫描多通道 |
| ContinuousConvMode | Disable | 序列结束等待下一次触发 |
| DiscontinuousConvMode | Disable | 一次触发执行完整序列，不拆小组 |
| Regular Conversions | Enable | 启用规则组配置，不等于开始转换 |
| NbrOfConversion | 4 | 每轮 4 次转换，核对四个 Rank |
| ExternalTrigConv | HRTIM TRG1 | 接收内部触发输出 1 |
| ExternalTrigConvEdge | Rising | 内部触发信号上升沿，不是模拟输入或 PWM 引脚边沿 |
| DMAContinuousRequests | Enable | 后续转换继续产生 DMA 请求 |
| EOCSelection | End of sequence | 完成判断选择整序列；不改变逐通道 DMA 搬运，也不自动开启中断 |
| Overrun | Data overwritten | DR 未及时取走时新值覆盖旧值；不同于循环 DMA 正常覆盖内存 |
| LowPowerAutoWait | Disable | 不通过自动等待读走旧结果来暂停后续转换 |
| SamplingTime | 4.5 ADC cycles | 采样保持阶段长度；不是完整转换时间 |

`SequencerNbRanks=1` 在该 CubeMX 版本中的准确含义未确认。当前生成代码明确为 `NbrOfConversion=4` 且有 Rank1～4，不能凭这个界面字段判断只采一个通道。

规则组用于当前顺序采样；注入组具有独立序列与结果寄存器，本工程未使用。模拟看门狗未启用，不代表没有软件保护。

### 10.2 触发必须两端连接

HRTIM 侧 **【CubeMX生成】**，在界面选择 Timer A CMP3 → ADC Trigger 1：

```c
pADCTriggerCfg.UpdateSource = HRTIM_ADCTRIGGERUPDATE_TIMER_A;
pADCTriggerCfg.Trigger = HRTIM_ADCTRIGGEREVENT13_TIMERA_CMP3;
HAL_HRTIM_ADCTriggerConfig(&hhrtim1, HRTIM_ADCTRIGGER_1,
                          &pADCTriggerCfg);
```

ADC 侧 **【CubeMX生成】**，在界面选择 HRTIM TRG1、上升沿：

```c
hadc1.Init.ExternalTrigConv = ADC_EXTERNALTRIGCONVHRTIM_TRG1;
hadc1.Init.ExternalTrigConvEdge = ADC_EXTERNALTRIGCONVEDGE_RISING;
```

`Trigger` 选择触发事件；`UpdateSource` 选择触发配置的更新来源，不能混用。

启动顺序：

```text
CubeMX：选择时钟、模拟引脚、Rank、采样时间、触发源       【你在界面配置】
    ↓
MX_DMA_Init / MX_ADC1_Init / MX_HRTIM1_Init 等调用         【CubeMX生成】
    ├─ HAL_ADC_Init / HAL_ADC_ConfigChannel 等调用         【CubeMX生成】
    │    └─ 写入 ADC 配置寄存器                          【HAL内部】
    ├─ GPIO、DMA1_Channel1 配置及 HAL_DMA_Init 调用         【CubeMX生成】
    └─ __HAL_LINKDMA(adcHandle, DMA_Handle, hdma_adc1)       【CubeMX生成】
    ↓
定义持久缓冲区 uint16_t ADC1_RESULT[4]                    【你编写】
调用 HAL_ADC_Start_DMA(&hadc1, ..., 4)，检查返回值         【你编写】
    ├─ 设置 DMA 完成/半完成/错误的内部回调                【HAL内部】
    ├─ 配置本次 DR 地址、缓冲区地址、传输长度并启动 DMA    【HAL内部】
    └─ 使 ADC 就绪，等待外部触发                         【HAL内部】
    ↓
调用 HAL_HRTIM_WaveformCountStart(...Timer A...)          【你编写】
    └─ 开启计数                                         【HAL内部】
    ↓
计数达到 CMP3 → 内部 TRG1 → ADC 按 Rank 转换              【硬件自动】
每个通道结果写 DR → 请求 DMA → 写入对应数组元素           【硬件自动】
    ↓
四次搬运结束，循环 DMA 重装；ADC 等待下一次触发           【硬件自动】
    │
    ├─ 当前处理路径：TIM3 IRQ → ADCSample()               【你编写调用与算法】
    │
    └─ 快照方案（TODO，需启用 Channel1 中断）：
         进入 DMA1_Channel1_IRQHandler                  【CPU响应】
         调用 HAL_DMA_IRQHandler(&hdma_adc1)             【CubeMX生成】
         HAL 内部 ADC DMA 完成函数                       【HAL内部】
         调用 HAL_ADC_ConvCpltCallback(hadc)              【HAL内部】
         实现该回调，复制快照并置 ready                  【你编写】
         主循环安全取走快照、清 ready、处理数据           【你编写】
```

外部触发模式下不需要在每次 HRTIM 中断中重新启动 ADC。DMA 搬运也不依赖 CPU 进入 DMA IRQ。

**你需要改／补的部分**：缓冲区、启动及返回值处理、采样处理函数、需要时的快照接口与 ADC 标准回调。HAL 已关联内部 DMA 回调，不要额外覆盖 `XferCpltCallback`。快照方案的 Channel1 NVIC 和 IRQ 优先通过 CubeMX 生成，再添加业务回调。

### 10.3 触发频率、转换耗时、处理频率分开计算

- 12 位转换名义耗时：`采样周期数 + 12.5` 个 ADC 时钟周期。
- 当前每通道约 `(4.5+12.5)/16 MHz = 1.0625 μs`；四通道约 `4.25 μs`，未计触发同步等额外延迟。
- HRTIM 名义每 `5 μs` 触发一次，须核对整个序列能否在触发节拍内完成，不能认为任何触发频率都能接收。
- 短采样时间是否足够，要结合前端输出阻抗与采样电容充电建立时间。
- 四通道顺序采样，序列触发在中点不代表所有通道在中点采样。
- TIM3 约每 `5.1568 ms` 处理一次，期间约有 1031 轮触发；四元素数组不保存这些历史轮次，软件也没有自动平均它们。

ADC2 是另一条路径：单通道、软件启动、连续转换，用于电位器参考值。`HAL_ADC_GetValue()` 读取结果，不等同于启动一次新转换。

零电流初值 2048 对应半量程：若零点为 1.65 V、参考为 3.3 V，则名义码值约为 `1.65/3.3×4096=2048`。硬件偏置让双向电流映射到正电压范围；实际零点应由零电流测量校准。

## 11. 串口 DMA：配置、标志与回调接入

### 11.1 配置速查

本表中的初始化均为 **【CubeMX生成】**：串口、GPIO、TX DMA 与句柄关联在 `usart.c`；DMA 时钟和 Channel4 NVIC 在 `dma.c`；IRQ 入口及 HAL 处理调用在 `stm32f3xx_it.c`。VOFA 打包、发送调用和标准完成回调由 **【你编写】**。

| 项目 | 本工程配置 | 作用 |
|---|---|---|
| 串口 | USART1，921600，8N1 | 上位机参数保持一致 |
| GPIO | PB6 TX / PB7 RX，AF7 | 外设信号连接到引脚 |
| 方向 | TX_RX | 允许收发，不自动启动接收 |
| 过采样 | 16，单点采样关闭 | 接收时钟与判决设置，不是重复发送 16 次 |
| DMA | DMA1_Channel4 | USART1 TX 搬运通道 |
| 方向 | Memory to peripheral | 内存帧缓冲区 → TDR |
| 地址 | 外设固定、内存递增 | 逐字节读取发送帧 |
| 宽度 | 两端 Byte | 每个传输单元 1 字节 |
| 模式 | Normal | 每帧启动一次，搬完停止 |
| 句柄关联 | `__HAL_LINKDMA(..., hdmatx, ...)` | HAL 串口句柄与 DMA 句柄关联 |
| NVIC | DMA Channel4 与 USART1 | 分别处理搬运完成和最终串口完成 |

8N1 每字节线上占 10 位：起始 1 + 数据 8 + 停止 1。四通道 20 字节名义耗时 `20×10/921600 ≈ 217 μs`，不含软件间隔。

字节内 LSB 先发与 float 的四字节小端排列是两件事。STM32 上 `1.0f` 的示例字节为 `00 00 80 3F`；迁移时核对 float 格式、大小和字节序。

### 11.2 TC、TCIE、HAL 状态与应用状态

| 名称 | 类型 | 谁管理 | 不代表什么 |
|---|---|---|---|
| TC | USART ISR 发送完成状态 | 硬件置位；HAL 按规定清旧标志 | 不是中断开关 |
| TCIE | USART CR1 完成中断使能 | 当前 HAL 软件开关 | 清它不等于清 TC，也不停止发送 |
| `huart->gState` | HAL 驱动状态 | HAL | 不会自动同步应用 busy |
| `g_vofa_tx_busy` | 应用缓冲区占用状态 | 用户代码 | 不是硬件位或严格互斥锁 |

普通 DMA 发送的完整链路：

```text
主循环按需调用 vofa_send_channels(4U)                   【你编写】
    ├─ 检查 g_vofa_tx_busy；忙则返回 BUSY，不排队          【你编写】
    ├─ 打包 float，追加帧尾                              【你编写】
    ├─ g_vofa_tx_busy = 1                                【你编写：置忙】
    └─ 调用 HAL_UART_Transmit_DMA(...)                   【你编写：调用】
         ├─ 检查 gState，设置 BUSY_TX                    【HAL内部】
         ├─ 配置本次 DMA 地址、长度与内部回调             【HAL内部】
         ├─ 清旧 TC，启动 DMA，允许 UART TX DMA 请求      【HAL内部】
         └─ 返回状态
              ├─ 非 HAL_OK：busy=0，返回 ERROR           【你编写：失败恢复】
              └─ HAL_OK：保持 busy=1，返回启动成功        【你编写】
                   ↓
DMA 从帧缓冲区逐字节读取并写入 UART TDR                  【硬件自动】
UART 通过 TX 引脚逐位发送                                【硬件自动】
                   ↓
DMA 搬运完成，置完成标志并请求中断                       【硬件自动】
进入 DMA1_Channel4_IRQHandler                           【CPU响应】
    └─ HAL_DMA_IRQHandler(&hdma_usart1_tx) 调用           【CubeMX生成】
         ├─ 判断事件、清 DMA 标志、调用内部完成函数       【HAL内部】
         └─ 普通发送结束 DMA 请求，打开 TCIE              【HAL内部】
                   ↓
最后字节及停止位发完，TC=1；TCIE=1 时请求 UART 中断       【硬件自动】
进入 USART1_IRQHandler                                  【CPU响应】
    └─ HAL_UART_IRQHandler(&huart1) 调用                 【CubeMX生成】
         ├─ 识别 TC 完成，关闭 TCIE                      【HAL内部】
         ├─ gState = READY                              【HAL内部】
         └─ 调用 HAL_UART_TxCpltCallback                 【HAL内部】
              └─ 实现该回调，调用模块完成函数             【你编写】
                   └─ 匹配 USART1，g_vofa_tx_busy=0       【你编写：清忙】
                        ↓
                   允许下一次发送
```

TC 与 TCIE 同时有效才请求 TC 中断；CPU 响应还依赖 NVIC 与屏蔽状态。清 TCIE 只关闭该通知，不清 TC。

**你需要改／补的部分**：通道数组和持久帧缓冲区、打包函数、发送调用频率、忙检查、启动失败恢复、`HAL_UART_TxCpltCallback()` 内的分发与清忙。无需手动改 TCIE 或 HAL 的 gState。生成的 IRQ 内已有 HAL 调用就保留；不要另加一次相同调用。

### 11.3 自定义回调不会自动执行

函数叫 `vofa_tx_complete_callback()` 并不意味着 HAL 会识别它。当前使用默认弱回调模式时，需连接标准入口：

```c
void HAL_UART_TxCpltCallback(UART_HandleTypeDef *huart)
{
    vofa_tx_complete_callback(huart);  // 【你编写】连接应用回调
}
```

用户同名实现替代 HAL 的 `__weak` 默认空函数。多串口时按句柄或实例分发；同一个标准回调不要在多个文件重复定义。

原问答中发现并修正的旧路径：在 DMA IRQ 末尾直接关 TCIE、手动设 `gState=READY`、清 busy。问题是 IRQ 可能来自半传输或错误，且 DMA 搬完不等于 UART 发完。不要沿用这段绕过 HAL 收尾的写法。

`if (HAL_UART_Transmit_DMA(...) != HAL_OK)` 中的函数会先执行，再比较返回值。失败分支清 busy 只恢复应用状态，不会直接覆盖帧缓冲区。

浮点打包应复制二进制表示，可用 `memcpy(dst, &value, sizeof value)`；`(uint8_t)value` 是数值转换，会丢失小数。当前实现用 union 访问四个字节，迁移时需核对目标实现。

## 12. TIM 与 HRTIM 中断：为什么还要判断事件

`TIM3_IRQHandler()` 只确定哪个 IRQ 入口被响应；更新、捕获/比较、触发等来源可能共享入口。

```text
CubeMX 选择时钟、PSC、ARR、更新中断                     【你在界面配置】
MX_TIM3_Init、时钟/NVIC、TIM3 IRQ 框架                   【CubeMX生成】
    ↓
调用 HAL_TIM_Base_Start_IT(&htim3)，检查返回值            【你编写】
HAL 使能更新中断 UIE 并启动计数                          【HAL内部】
    ↓
计数溢出，更新事件置 UIF，请求中断                       【硬件自动】
进入 TIM3_IRQHandler                                    【CPU响应】
    └─ HAL_TIM_IRQHandler(&htim3) 调用                   【CubeMX生成】
         ├─ 检查 UIF/UIE，清 UIF                         【HAL内部】
         └─ 调用 HAL_TIM_PeriodElapsedCallback           【HAL内部】
              └─ 默认弱实现为空；需要时写业务实现         【你编写】
    ↓
当前工程 IRQ 的 USER CODE 区直接调用：
ADCSample → 保护 → KEYFlag → StateM → VrefGet 等           【你编写】
```

- UIF 是发生状态，UIE 是中断使能。清 UIF 不停止计数，也不关闭 UIE。
- 默认 `HAL_TIM_PeriodElapsedCallback()` 基本为空；业务函数需自行接入。
- 当前工程在 HAL 处理后直接调用 `ADCSample()` 等函数，它们不是 HAL 自动调用的。
- 放在 IRQ 末尾的业务代码会在任何进入该 IRQ 的来源下执行；只想在更新事件执行时，放到周期回调并区分实例。
- 可以使用 HAL 分发，也可以手动判断来源并清标志；不要漏清，不要重复处理同一事件。

**你需要改／补的部分**：启动调用、业务执行位置与顺序。若迁移到周期回调，删除 IRQ 末尾对应的重复业务调用；若采用手动事件处理，自己写来源判断与清标志。不要同时使用两条路径执行同一业务。

HRTIM 重复事件有两个独立用途：

```text
重复事件 → 预装载更新：硬件参数生效
重复事件 → 中断请求：CPU 执行控制算法
```

重复计数器配置、重复更新允许、外设中断使能和 NVIC 使能是不同设置。`WaveformCountStart()` 只启动计数；`WaveformCountStart_IT()` 按 HAL 配置启动相应中断，或采用普通启动后显式使能事件中断的方式。

## 13. HRTIM 配置速查与运行流程

下表配置由你在 CubeMX 选择后生成到 `MX_HRTIM1_Init()`。DLL 校准调用、TimeBase/Compare/Timer/Output/DeadTime/ADCTrigger 配置调用及 GPIO 复用，均标为 **【CubeMX生成】**。运行中启停、CMP 动态更新、PI 调用及其事件安排为 **【你编写】**。

| 设置 | 本工程值／用途 | 迁移注意 |
|---|---|---|
| DLL 校准 | 初始化启动并等待校准完成 | 支持高分辨率定时，核对返回值 |
| Period / MUL16 | 10240 / ×16 | 结合 HRTIM 时钟计算频率，不照搬数值 |
| Continuous | 连续运行 | 不等于中断开启 |
| RepetitionCounter | 0 | 每计数周期产生重复事件 |
| Preload | Enable | 参数暂存，等待更新事件 |
| RepetitionUpdate | Enable | 重复事件允许预装载转入有效值 |
| UpdateGating | Independent | 不依赖 Burst DMA 完成；不是立即更新 |
| ResetUpdate | Disable | 不通过该复位更新路径更新参数，不阻止计数循环 |
| StartOnSync / ResetOnSync | Disable | A、B 不因此自动对齐；同频不等于同相 |
| PushPull | Disable | 不是本方案互补 PWM 开关 |
| DeadTimeInsertion | Enable | 输出配对经死区单元形成互补时序 |
| FaultEnable | None | 未接入该硬件 Fault 路径，软件保护仍独立存在 |
| Timer B Interrupt/DMA | None | B 不请求这些中断/DMA，不影响 ADC DMA |

波形生成顺序：

```text
CubeMX 选择时基、比较值、输出事件、死区、GPIO、NVIC      【你在界面配置】
    ↓
MX_HRTIM1_Init：初始化与 DLL 校准调用                    【CubeMX生成】
    ├─ HAL_HRTIM_TimeBaseConfig(...A/B...)               【CubeMX生成】
    ├─ HAL_HRTIM_WaveformTimerConfig(...)                【CubeMX生成】
    ├─ HAL_HRTIM_WaveformCompareConfig(...CMP1/CMP3...)   【CubeMX生成】
    ├─ HAL_HRTIM_WaveformOutputConfig(...TA/TB...)        【CubeMX生成】
    ├─ HAL_HRTIM_DeadTimeConfig(...)                     【CubeMX生成】
    ├─ HAL_HRTIM_ADCTriggerConfig(...)                   【CubeMX生成】
    └─ HAL_HRTIM_MspPostInit：GPIO 复用                  【CubeMX生成】
         └─ 上述接口内部写寄存器                        【HAL内部】
    ↓
确定安全比较值、启停条件与 A/B 同步策略                  【你设计／编写】
调用 WaveformCountStart 或 CountStart_IT                 【你编写】
调用 WaveformOutputStart，按状态机允许输出               【你编写】
    ↓
计数 → 周期置位/CMP1复位 → 死区互补 → 引脚输出           【硬件自动】
CMP3 → HRTIM TRG1 → ADC 序列                             【硬件自动】
    ↓
动态调节路径（需接通，当前 PI 调用待补）：
重复事件请求中断（必须已使能）                          【硬件自动】
进入 HRTIM1_TIMA_IRQHandler                              【CPU响应】
    ├─ HAL_HRTIM_IRQHandler(...) 调用                    【CubeMX生成：HAL路径】
    │    └─ 识别/清标志、调用对应事件回调                【HAL内部】
    │         └─ 实现事件回调，调用 PI                    【你编写：待补】
    │
    └─ 或参考工程手动路径：判断/清重复标志、调用 PID      【你编写：替代HAL路径】
         ↓
校准反馈 → 误差 → PI/PID → 限幅 → Q12 占空比             【你编写】
写 CMP1；写 CMP3=CMP1/2；按公式写 B 的 CMP1               【你编写】
         ↓
预装载暂存 → 配置的更新事件使值生效                     【硬件自动】
后续波形与采样位置采用新比较值                          【硬件自动】
         ↓
故障／停机：修改应用标志、管理积分、调用 OutputStop      【你编写】
```

**你需要改／补的部分**：A/B 计数启动、输出启停、需要时的重复中断使能、PI 事件调用、比较值更新、控制状态复位。CubeMX 生成 IRQ 与 NVIC 不保证事件中断已经启动。当前 HAL IRQ 分发与参考工程手动清标志是两种处理方式，不能把参考代码直接追加在 HAL 处理后重复处理同一事件。

此流程是完整使用模板，包含待补环节，不代表当前工程所有路径已运行。CubeMX 生成初始化后不要在 while 中反复初始化来改变占空比；动态修改由比较寄存器或 HAL 更新接口完成。

输出：A 为 PA8/PA9，B 为 PA10/PA11；GPIO 使用 HRTIM 复用。输出1 Active HIGH 与输出2 Active HIGH 不冲突，有效极性与互补关系是不同配置。

死区：`MUL8`、Rising/Falling Value=180、Positive。按 HRTIM 128 MHz，名义死区约 `180/(128 MHz×8)=175.8 ns`；不能用 PWM 的 MUL16 来计算。死区值不是直接以 ns 为单位；锁定配置影响运行中修改，需按外设复位机制处理。

- 正死区让两路短暂都无效，实际两路有效占空比之和小于 100%。
- IdleLevel、FaultLevel 和输出禁用行为需结合外设规则，不能把 IdleLevel 直接等同于 OutputStop 后引脚电平。
- 截图、`.ioc` 与生成代码可能不同，核对实际编译文件；问答中曾出现截图 IdleLevel=Active、磁盘代码=Inactive。
- 比较：计数达到预设值产生事件；捕获：事件到来保存当前计数值。

Timer B 公式：

```c
CMP1_B = PERIOD - (BoostDuty * PERIOD >> 12);
```

因此 `BoostDuty` 增大，输出1名义占空比减小。`BoostDuty=283` 时 CMP1=9533、TB1 约 93.1%；初始化 CMP1=9000，约 87.89%。初始化值与控制运行后的值不能混淆。

采样相位不是固定在整个周期中：

| 名义占空比 | CMP3 占周期比例 |
|---|---|
| 25% | 12.5% |
| 50% | 25% |
| 75% | 37.5% |

触发点跟随高电平中点；频率保持同步，周期内位置随占空比变化。

## 14. 参考 PID 与当前 PI：移植时必须一起修改的内容

| 项目 | 当前 MINI_LOOP | 参考 05Buck-Mode-VLoop-PID |
|---|---|---|
| 算法 | 位置式 PI | 增量式 PID |
| 系数尺度 | Q12 | b0/b1/b2 为 Q8 |
| 控制输出转 Q12 占空比 | `u0 >> 12` | `u0 >> 8` |
| 历史状态 | 函数内 static 积分 | 前两次误差、上次内部输出 |
| 控制调用 | 当时未找到 | Timer A 重复 IRQ 中调用 |
| 计数启动 | 当时只见 A | A、B 均启动，另显式开启 A 重复中断 |

**参考工程有闭环调用，不代表当前工程已继承完整闭环。**`StateMRun()` 为空也不代表没有控制，控制可能在另一条高速中断路径中。

### 增量 PID 与 Ts

采用矩形积分、后向差分时：

```text
Δu[k] = Kp·(e[k]−e[k−1]) + Ki·Ts·e[k]
      + Kd/Ts·(e[k]−2e[k−1]+e[k−2])

u[k] = u[k−1] + b0·e[k] + b1·e[k−1] + b2·e[k−2]
b0 = Kp + Ki·Ts + Kd/Ts
b1 = −Kp − 2Kd/Ts
b2 = Kd/Ts
```

- Ts 是两次控制计算之间的时间，单位秒，不一定等于 PWM 或 ADC 周期。
- 连续意义的 Ki/Kd 要合并 Ts；已离散化参数或最终 b 系数不能重复乘除 Ts。
- 系数可在初始化或参数改变时计算，无需每次中断重算。
- 恒定非零误差时，P/D 增量为零，I 仍让输出逐次变化。
- 增量式不自动抗积分饱和；参考代码先保存 `u1=u0` 再限最终占空比，内部状态未跟随限幅。
- PI 替换 PID 后，原来清误差和历史输出的代码不能复位新引入的静态积分。

### 移植暴露的流程问题

- Wait 计数满足后，当前代码先开启 A 输出，再检查按键启动条件；不能把 Wait 直接当成绝对停波状态。
- 若 PI 未运行，软件最小占空比不会写入硬件，CMP1 仍可能是初始化 5000，即名义 48.83%。
- 参考控制运行时会在软件禁用情况下写最小占空比 80，即约 1.95%，也不是明确的零输出。
- 软启动只改变上限变量，必须有控制函数读取限幅并写 CMP 才影响实际脉宽。
- 软启动增长计数器、积分和参考值的重启行为需要分别核对；参考值减半后还可能被后续 `VrefGet()` 更新，不能仅凭这一句认定完整参考斜坡。
- A/B 先后启动不建立严格相位同步，启动顺序和输出安全初值需要单独设计。
- 调试宏只选择主循环发送内容，不自动关闭中断中的状态机与输出逻辑。

## 15. 查询入口与最小排错顺序

| 问题 | 先查看 |
|---|---|
| ADC 通道/触发/采样时间 | `adc.c` |
| ADC DMA 宽度与句柄关联 | `adc.c` 中 `HAL_ADC_MspInit()` |
| 串口格式/TX DMA/GPIO | `usart.c` |
| DMA 时钟与 NVIC | `dma.c` |
| IRQ 与业务实际调用 | `stm32f3xx_it.c` |
| HRTIM 时基/输出/死区/更新 | `hrtim.c` |
| 外设是否实际启动 | `main.c`、状态机 |
| 校准/滤波/启停/保护 | `function.c` |
| PI/PID 计算与 CMP 更新 | `CtlLoop.c` |
| 打包/忙状态/串口回调 | `vofa.c` |

外设无动作时按顺序查：**实际编译文件 → 时钟/GPIO → 配置 → 启动返回值 → 硬件事件 → DMA或输出 → IRQ使能 → HAL分发 → 用户回调 → 应用状态。**
