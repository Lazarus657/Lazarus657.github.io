---
title: DCDC 学习复盘（二）：执行框架、中断与闭环时序
date: 2026-10-08
categories: [学学笔记]
tags: [DCDC, STM32, HRTIM, 中断, ADC, 闭环控制]
description: 复盘执行框架与中断职责，核对 HAL 回调、PWM/ADC 跨周期时序，以及软启动、PI 与真实输出的闭环调用关系。
coverImg: /covers/hardware.svg
---

# DCDC 学习复盘（二）：执行框架、中断与闭环时序

整理日期：2026-10-08。

范围：第一份复盘文档生成后的讨论。重点保留错误理解、纠正结论及迁移要点；与第一份配置速查互为补充。

工程：STM32F334 `MINI_LOOP`；参考：`05Buck-Mode-VLoop-PID`。以下源码状态来自本轮读取，后续修改需重新核对。

## 1. 执行位置与频率：配置存在不等于正在运行

| 原回答／易错点 | 修正结论 |
|---|---|
| ADC 由“定时器1”CMP3 触发 | 是 **HRTIM Timer A**，不是普通 TIM1。CMP3 经内部 TRG1 触发 ADC。 |
| ADC1、DMA 都在 main.c 执行 | main.c 调用启动接口；实际转换与搬运由硬件执行。 |
| ADCSample、状态机、保护均为 200 Hz | 当前 TIM3 实际约 **193.92 Hz**，200 Hz 只是近似值。 |
| PI 在 IRQ 中按 200 kHz 执行 | 当前源码未找到 PI 调用，重复事件中断也未实际使能，不能填写为已执行。 |
| VOFA 精确每 500 ms 发送一次 | 主循环延时 500 ms 后再次尝试发送，还包含代码执行时间；忙时本次可能不发送。 |

核对后的表：

| 功能 | 启动／执行位置 | 频率或触发条件 |
|---|---|---|
| ADC1 转换 | main.c 启动等待；HRTIM 硬件触发 | Timer A CMP3 → TRG1，每轮名义 200 kHz |
| ADC DMA | main.c 启动；DMA1_Channel1 硬件搬运 | 每个通道结果产生后搬一次，四次组成一轮 |
| ADCSample | TIM3_IRQHandler 中用户调用 | 约 193.92 Hz |
| 状态机与软件保护 | TIM3_IRQHandler 中用户调用 | 约 193.92 Hz |
| PI | CtlLoop.c 有定义，当前未接入执行路径 | 无实际调用频率；200 kHz 是候选控制节拍 |
| VOFA | main.c 的 ADC 调试循环 | 约每 500 ms 尝试发送 |

TIM3 输入时钟为 64 MHz、PSC=32、ARR=10000：

```text
T = (PSC+1) × (ARR+1) / fTIM3
  = 33 × 10001 / 64000000
  = 5.156765625 ms

f ≈ 193.92 Hz
```

迁移要点：普通 TIM 的 PSC、ARR 计算需按计数规则加 1；定时器输入时钟需核对 APB 分频与定时器倍频规则，不能直接采用 CPU 时钟或注释。

## 2. 计数启动、输出使能、中断使能、算法调用是四件事

原误解：`WaveformCountStart()` 和 `_IT` 都开启 PWM 引脚，后者“以中断方式输出 PWM”。

| 操作 | 接口／位置 | 责任 |
|---|---|---|
| 配置时基、波形、GPIO、事件与 NVIC | MX_HRTIM1_Init、MSP、NVIC 配置 | 【CubeMX生成】参数由用户选择 |
| 启动计数 | HAL_HRTIM_WaveformCountStart | 【你编写调用】不负责使能事件中断 |
| 启动计数并使能已配置中断 | HAL_HRTIM_WaveformCountStart_IT | 【你编写调用】【HAL内部执行】 |
| 开启指定输出 | HAL_HRTIM_WaveformOutputStart | 【你编写调用】 |
| 执行 PI/PID | IRQ 或事件回调中的算法调用 | 【你编写】不因输出开启而自动执行 |

PWM 边沿由硬件产生，`_IT` 不表示 CPU 在中断中翻转引脚。

```c
// 启动 A 计数，不直接开启 TA1/TA2 输出
HAL_HRTIM_WaveformCountStart(&hhrtim1, HRTIM_TIMERID_TIMER_A);

// 允许 TA1/TA2 输出，仍需计数与波形/GPIO 配置正确
HAL_HRTIM_WaveformOutputStart(
    &hhrtim1, HRTIM_OUTPUT_TA1 | HRTIM_OUTPUT_TA2);

// B 的计数与输出需要分别安排
HAL_HRTIM_WaveformOutputStart(
    &hhrtim1, HRTIM_OUTPUT_TB1 | HRTIM_OUTPUT_TB2);
```

`WaveformOutputStop()` 关闭指定输出使能，不自动停止计数、ADC 触发或算法调用。最终引脚电平需结合外设输出配置判断。

## 3. “重复中断实际使能”是什么

原误解：配置 `InterruptRequests=REP` 后，CPU 一定进入中断。

| 设置 | 控制内容 | 不等于什么 |
|---|---|---|
| RepetitionCounter=0 | 每个周期产生重复事件 | 不等于开启 CPU 中断 |
| RepetitionUpdate=Enable | 重复事件可更新预装载参数 | 不等于执行控制算法 |
| InterruptRequests=REP | HAL 保存准备使用的事件中断配置 | 初始化配置不等于运行时使能 |
| 外设 REP 中断使能 | 允许事件向 CPU 请求中断 | 不等于 NVIC 已放行 |
| NVIC HRTIM1_TIMA 使能 | CPU 中断控制器允许该 IRQ | 不替代外设内部使能 |
| IRQ／回调中调用 PI | 执行业务算法 | IRQ 存在不等于 PI 已接入 |

两种启动方式选择一种：

```c
// 方式 A：【你编写】普通启动后显式使能重复中断
HAL_HRTIM_WaveformCountStart(&hhrtim1, HRTIM_TIMERID_TIMER_A);
__HAL_HRTIM_TIMER_ENABLE_IT(
    &hhrtim1, HRTIM_TIMERINDEX_TIMER_A, HRTIM_TIM_IT_REP);

// 方式 B：【你编写】使用已配置 InterruptRequests 的 HAL 中断启动
HAL_HRTIM_WaveformCountStart_IT(
    &hhrtim1, HRTIM_TIMERID_TIMER_A);
```

这是替代方案，不是要求把两套代码全部叠加；HAL 启动接口需检查返回值。

```text
Timer A 运行 → 重复事件发生                         【硬件自动】
    ↓
REP 外设中断使能 + NVIC 允许 + CPU 未屏蔽             【运行前提】
    ↓
进入 HRTIM1_TIMA_IRQHandler                          【CPU响应】
    ↓
事件处理 → 算法调用                                 【软件路径】
```

ADC 的 CMP3 硬件触发不依赖重复中断。重复更新也可以由硬件完成，不需要 CPU 每周期参与。

## 4. IRQ 入口与事件回调：两条处理路径

原误解：把 `HRTIM1_TIMA_IRQHandler()` 当成重复事件回调，认为当前缺少 IRQ 函数。

当前工程已有 IRQ 和 HAL 处理调用；缺少的是重复中断使能及 PI 业务调用。IRQ 是中断入口，回调是 HAL 处理某种事件后调用的函数。

### 4.1 当前工程可采用的 HAL 路径

```c
// 【CubeMX生成】入口与 HAL 处理调用
void HRTIM1_TIMA_IRQHandler(void)
{
    HAL_HRTIM_IRQHandler(&hhrtim1, HRTIM_TIMERINDEX_TIMER_A);
}
```

HAL 内部检查重复标志与使能位，清除标志，再调用重复事件回调。用户补充：

```c
// 【你编写】放在用户文件或可保留的 USER CODE 区域
// 需要 hrtim.h、CtlLoop.h 提供句柄与算法声明
void HAL_HRTIM_RepetitionEventCallback(
    HRTIM_HandleTypeDef *hhrtim, uint32_t TimerIdx)
{
    if ((hhrtim == &hhrtim1) &&
        (TimerIdx == HRTIM_TIMERINDEX_TIMER_A))
    {
        BUCKVLoopCtlPI();
    }
}
```

```text
重复事件
→ HRTIM1_TIMA_IRQHandler             【CPU进入；入口CubeMX生成】
→ HAL_HRTIM_IRQHandler              【调用CubeMX生成】
→ 检查来源、清标志                   【HAL内部】
→ HAL_HRTIM_RepetitionEventCallback  【HAL调用】
→ BUCKVLoopCtlPI                    【你编写回调和调用】
```

- HAL 默认提供 `__weak` 空回调，所以没有用户实现也能编译，但不会执行 PI。
- 当前默认弱回调方式下，用户同名普通函数替代空实现；无需在 IRQ 再手动调用回调。
- 不要在多个文件重复定义同一个标准回调；多个 TimerIdx 可在一个回调中分发。
- 若启用 HAL 动态回调注册机制，需另核对注册配置，不能直接套用默认弱回调结论。

### 4.2 参考工程的直接处理路径

```c
CCMRAM void HRTIM1_TIMA_IRQHandler(void)
{
    // 不走 HAL 事件分发
    // HAL_HRTIM_IRQHandler(&hhrtim1, HRTIM_TIMERINDEX_TIMER_A);

    HRTIM1->sTimerxRegs[HRTIM_TIMERINDEX_TIMER_A].TIMxICR =
        HRTIM_TIM_IT_REP;                  // 【你编写】清重复标志

    BUCKVLoopCtlPID();                     // 【你编写】直接调用算法
}
```

```text
重复事件 → IRQ → 手动清标志 → PID
```

| 比较项 | 直接处理 | HAL 路径 |
|---|---|---|
| 来源识别 | 参考代码未判断，假设只有 REP | HAL 检查标志与使能位 |
| 清标志 | 用户写 TIMxICR | HAL 清除 |
| 算法入口 | IRQ 直接调用 | 用户事件回调调用 |
| 通用分发开销 | 较少 | 包含通用事件处理 |
| 扩展其他中断源 | 需补来源判断 | 可按 HAL 回调分发 |

关键约束：

- 写 `TIMxICR` 清除已发生的标志，不开启中断，也不关闭后续中断。
- 直接路径若以后开启其他 Timer A 事件，不能每次进入 IRQ 都无条件执行 PID。
- 两条路径选择一种；不要在 HAL 回调执行 PI 后，又在 IRQ 末尾执行一次。
- `CCMRAM` 指定函数段，与中断开关无关；实际放置与初始化由链接和启动配置决定。
- 示例说明处理方式，不代表已修改工程，也不证明 5 μs 内能执行完毕。

## 5. 时序图错误：触发、转换完成、计算、生效必须分开

原图把 ADC 触发放在周期开始附近，把 PWM 下降沿画在 CMP3。

正确对应：

- 周期事件：名义波形置高。
- CMP3：启动 ADC 规则序列。
- CMP1：名义波形复位。
- 四个 Rank：依次采样、转换与 DMA 搬运。
- 重复事件：可用于更新与 CPU 控制节拍。
- CPU 写比较值：不等于有效比较值立即改变。

```text
周期开始          CMP3          CMP1              下一周期
    │               │             │                   │
PWM ┌─────────────────────────────┐                   ┌─
    │                             └───────────────────┘
    │               ↑                                 │
    │           ADC序列触发                           │
    │               └─ Rank1 → Rank2 → Rank3 → Rank4 ─…
    ↑                                                 ↑
重复事件/控制计算                               重复事件/控制计算
```

示意按稳定运行、每周期重复事件建立，PWM 忽略死区。控制实际入口有中断延迟，不能视为周期边界瞬间完成。

### 初始化值下的名义时间估算

HRTIM=128 MHz、MUL16、PERIOD=10240，周期 5 μs；CMP3=2500。ADC=16 MHz，每通道名义转换耗时 1.0625 μs。

| 事件 | 相对本周期起点的时间 |
|---|---:|
| CMP3 触发 | 约 1.221 μs |
| Rank1 完成 | 约 2.283 μs |
| Rank2 完成 | 约 3.346 μs |
| Rank3（输出电压）完成 | 约 4.408 μs |
| 下一周期边界 | 5 μs |
| Rank4 完成 | 约 5.471 μs |

此估算未包含触发同步及 DMA 延迟，不能替代实测。序列可能跨周期；边界时 Rank3 可能已更新，而 Rank4 未更新。

### PI 使用哪一轮数据

- 在本周期起点运行 PI 时，本周期的 CMP3 尚未发生，所以不是使用本周期未来采到的值。
- 在下一周期起点读取 Rank3，是否获得上一周期结果，取决于 CMP3 位置、转换/DMA 完成时间与实际读取时刻。
- CMP3 随占空比改变，初始值下的时序结论不能永久沿用。
- 读取单个电压反馈与读取完整四通道组，具有不同的数据一致性要求。
- 若在某次重复更新之后才写预装载，新值通常等待后续更新事件；实际生效周期需查配置并验证。

迁移验收：标出 **序列触发 → 目标通道数据就绪 → 算法读取 → 新比较值生效**，再确认数据年龄与控制延迟。

## 6. 软启动上限怎样影响真实 PWM

已正确串联：

```text
状态机提高 BUCKMaxDuty                【你编写】
    ↓
PI 根据误差计算 BuckDuty              【你编写】
    ↓
用 BUCKMaxDuty / MIN_BUKC_DUTY 限幅    【你编写】
    ↓
CMP1 = BuckDuty × PERIOD >> 12         【你编写】
    ↓
更新事件将预装载转入有效值             【硬件自动】
    ↓
硬件按新比较值输出 PWM                【硬件自动】
```

**放宽上限不强制占空比增大。**如果 PI 本来输出小于旧上限，放宽后可能不变。

PI 未调用时，软件上限变化无法沿此链路传到 CMP1；硬件可能继续使用初始化比较值。缺少的是调用关系，不是限幅公式。

## 7. 本阶段结论与交接

已完成：

- 外设执行位置与频率表核对。
- 计数、输出、中断与业务调用的职责区分。
- HAL 回调路径与参考工程直接 IRQ 路径对比。
- PWM/ADC/控制时序的错误修正与跨周期分析。
- 状态机上限 → PI 限幅 → CMP → PWM 的闭环关系。

阶段结论：**代码框架理解阶段完成；完整闭环实现及实时性尚未验证。**

下一对话：整理可复用模块，优先审核已有 VOFA/串口模块的接口、依赖、示例、失败路径与缓冲区所有权，再整理 ADC、PWM、PI。

未完成 TODO：

- [ ] 接通重复中断与 PI 调用，二选一确定事件处理方式。
- [ ] 核对并补齐 Timer B 计数启动及 A/B 同步策略。
- [ ] 管理 PI 积分、软启动计数器的停机／重启状态。
- [ ] 实现 ADC 快照及 Channel1 完成中断，验证复制时间窗口。
- [ ] 验证目标反馈通道在 PI 读取前已完成 DMA 更新。
- [ ] 测量控制 ISR 最坏执行时间，核对 5 μs 预算及中断抢占影响。
- [ ] 验证比较值生效时刻、PWM 波形、死区与故障输出行为。
- [ ] 完成可复用模块、查询文档、最小示例与板上验收。

模块接口必须写清：输入输出、单位/Q尺度、调用周期、运行上下文、缓冲区生命周期、错误处理及启停复位策略。
