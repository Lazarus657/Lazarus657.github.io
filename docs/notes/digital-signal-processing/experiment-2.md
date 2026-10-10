---
title: 实验2：去噪、响应速度与滤波状态
date: 2026-10-10
categories: [数字信号处理]
tags: [MATLAB, 移动平均, 递归低通, 去噪, 滤波状态, 代码纠错]
description: 记录移动平均与递归低通的学习疑问、噪声与响应指标、参数选择和分块状态传递，整理 MATLAB 代码纠错与实验结果。
coverImg: /covers/hardware.svg
---

# 实验2：去噪、响应速度与滤波状态

> 范围：本次对话的MATLAB学习与考核。成绩89/100，通过。STM32验证未进行。
> 本笔记保留疑问、纠错、实测与可运行代码，省略重复提问及重复实验安排。

## 1. 实验主线

1. 用逻辑索引生成阶跃，检查时间、索引和样本数。
2. 手写因果移动平均与递归低通，使用`filter`核对。
3. 分别测量恒定段噪声标准差、无噪声阶跃上升时间。
4. 根据噪声与响应要求选择参数。
5. 编写带状态的函数，验证整段与分块一致，观察清零状态的误差。

两种算法：

```text
M点移动平均：y[n] = (x[n] + … + x[n−M+1]) / M
递归低通：  y[n] = y[n−1] + alpha × (x[n] − y[n−1])
```

统一初始条件：移动平均缺失历史视为0、分母固定为M；递归低通初始输出为0。

## 2. 我的疑问与关键解释

### 2.1 为什么数组条件用`&`，不用`&&`？

```matlab
mask = (t >= 0.5) & (t < 1.5);
```

`&`对数组逐元素判断；`&&`用于标量逻辑的短路判断。此处`t`是列向量，应使用`&`。

`x(mask)`读取符合条件的样本；`x(mask)=2`修改这些位置。统计该区间均值时，求和与分母必须来自同一段数据，不能只对区间求和却除以全段点数。

基础验证：fs=1000 Hz、4000点，最后时间为3.999 s；2 s处阶跃对应MATLAB索引2001；0.5≤t<1.5 s有1000点，阶跃前均值为1。

### 2.2 移动平均开头为什么除以M？

本实验选择固定M点滤波，记录前的输入补0。有效窗口不足M点时，分母也保持M。

```matlab
first = max(1, k-M+1);
window = x(first:k);
y(k) = sum(window)/M;
```

对`x=[1;2;3;4;5;6]`、M=4：

| 分母约定 | 输出 |
|---|---|
| 固定M，缺失历史补0 | 0.25、0.75、1.5、2.5、3.5、4.5 |
| 当前有效点数 | 1、1.5、2、2.5、3.5、4.5 |

第4点之前窗口不足4个；从第4点起两种分母相同。两种约定不能混用于参考对照或分块处理。

曾尝试维护累加值但未初始化、未移除旧样本、未保存`y(k)`。本章改用直接窗口求和；变量不要命名为`sum`，避免遮蔽函数。

### 2.3 `y_prev`应该更新成什么？

```matlab
y(k) = y_prev + alpha*(x(k)-y_prev);
y_prev = y(k);
```

先用上一输出计算当前输出，再保存当前输出供下一轮使用。

曾写`y_prev=y(k-1)`：k=1时会访问非法索引0，即使避开索引错误也会保存过早的状态。

对`x=[0;0;1;1;1;1]`、alpha=0.25、初始状态0，输出为：

```text
0、0、0.25、0.4375、0.578125、0.68359375
```

与`filter(alpha,[1,-(1-alpha)],x)`的最大误差为0。

### 2.4 为什么输入为1，输出不立即变为1？

不仅因为初始状态为0，更因为alpha=0.25时每次只修正剩余差值的25%。alpha=1时，公式化简为`y(k)=x(k)`，不再平滑。

| 参数变化 | 去噪趋势 | 响应趋势 |
|---|---|---|
| M增大 | 平滑更强、噪声标准差通常减小 | 上升时间增大 |
| alpha减小 | 平滑更强、噪声标准差通常减小 | 上升时间增大 |

曾将alpha变化方向写反：alpha增大更相信当前输入，响应更快，但噪声通常增大。

### 2.5 `sigma_in = std(x(mask))`是什么意思？

先取出测量区间，再计算该区间样本围绕自身均值的标准差：

```matlab
segment = x(mask);
sigma_in = std(segment);
```

标准差单位与信号相同，本实验为V。加常数偏置只改变均值，不改变标准差。

```matlab
reduction = 1 - sigma_out/sigma_in;
```

降低比例0.7738表示标准差减少77.38%，不是剩余77.38%。恒定段输出均值接近1 V但不必精确等于1 V，因为有限噪声记录的均值不必为0。

### 2.6 为什么16点移动平均更快达到2 V？

对1→2 V阶跃，M=16移动平均每收到一个新样本，就将窗口内一个1替换成2；输出每次增加1/16 V。收到16个新样本后输出恰好为2 V，第16个新样本位于2.015 s。

alpha=0.1递归低通每次修正剩余差值的10%：输出依次为1.1、1.19……；越接近2，单次增量越小，因此后期拖尾。

该比较针对M=16、alpha=0.1，不能推断某一类滤波器总是更快。

### 2.7 如何测上升时间，为什么阈值点不等于阈值？

阶跃初值1 V、终值2 V，10%阈值为1.1 V，90%阈值为1.9 V：

```matlab
k10 = find((t >= 2) & (y >= 1.1), 1, 'first');
k90 = find((t >= 2) & (y >= 1.9), 1, 'first');
rise_ms = (k90-k10)/fs*1000;
```

查找首次达到或超过阈值的样本，不要求电压恰好等于阈值。只搜索阶跃后，避免混入记录起点的启动瞬态。

| 算法 | k10 | k90 | 两处输出/V | 上升时间/ms |
|---|---:|---:|---|---:|
| M=16 | 2002 | 2015 | 1.1250、1.9375 | 13 |
| alpha=0.1 | 2002 | 2022 | 1.1900、约1.9015 | 20 |

理想计算alpha=0.1的第2001点为1.1 V、上升时间为21 ms；本次代码判为第2002点，可能因前段输出略小于1及浮点误差。未提交第2001点的高精度值，故该原因未最终核实。保留实际测得的20 ms，不更改滤波算法。

必要时查看：`fprintf('%.17g\n', y_iir(2001))`。上升时间不等于达到最终值的时间，也不等于完整系统延迟。

### 2.8 如何提取两个元素，而不是整个区间？

```matlab
y_ma([2002;2015])   % 两个指定元素
y_ma(2002:2015)     % 连续14个元素
```

离散索引用方括号组成数组，连续区间用冒号；`y_ma(2002;2015)`不是合法写法。

### 2.9 为什么加强平滑后，曾测得噪声反而变大？

问题来自测试数据混用：生成了`noise`却未加入输入，两段循环处理的是无噪声`x_step`，标准差分母却来自工作区旧变量`x`；`mask`也未在脚本中定义。

原先错误结果0.1009、0.1074 V及其降低比例作废。修正方法：明确区分`x_noise`与`x_step`，分别保存输出，在独立脚本开头`clear`，显式定义统计区间。

只对恒定段评价噪声，不能用包含真实阶跃的全段标准差；后者会把真实信号变化也计入波动。

### 2.10 分块为什么必须传递状态？

递归低通只需保存上一输出；16点移动平均的直接实现需保留前15个历史输入。一个平均值无法恢复15个输入，也无法确定下一次移除哪个旧样本。

上一块最后输出为0.25、下一块首个输入为1、alpha=0.25时：

```text
保留状态：0.25 + 0.25×(1−0.25) = 0.4375
清空状态：0    + 0.25×(1−0)    = 0.25
```

曾将保留状态结果算成0.5，属计算错误。状态保存的是上一输出及此前输入的累计影响，不是未来预测值。

## 3. 实测与参数选择

噪声使用恒定值1 V加随机噪声；统计区间0.5≤t<1.5 s。上升时间使用2 s处1→2 V的无噪声阶跃。表格汇总各次提交的记录，不重新生成数据替换原测值。

| 算法 | 输出噪声STD/V | 降低比例 | 上升时间/ms | 达标 |
|---|---:|---:|---:|---|
| M=16 | 0.0465 | 77.38% | 13 | 是 |
| M=64 | 0.0258 | 87.73% | 51 | 是 |
| alpha=0.1 | 0.0428 | 79.17% | 20 | 是 |
| alpha=0.02 | 0.0185 | 91.22% | 108 | 否，响应超时 |

基本目标：标准差降低至少50%，上升时间小于100 ms。首组两种输出均值均约1.0069 V；后组记录的输入标准差为0.2105 V。

若要求降低至少85%、上升时间小于60 ms，选择M=64：87.73%与51 ms同时满足。

M=4及alpha=0.5未实测；缓慢正弦、带噪阶跃与尖峰响应未单独运行。按精简学习要求取消重复操作，不将理论推断记录为实测。

## 4. MATLAB整理代码：输入隔离与指标计算

下列代码是依据本次对话整理的复习版本，注释标出曾出错的位置。新运行产生的数值需另行记录；以上表格仍为原提交记录。

保存为脚本，局部函数放在文件末尾。M和alpha可切换为64与0.02；无需为复习重新重复全部实验。

```matlab
clear; clc; close all;
fs = 1000;
N = 4000;
t = (0:N-1)'/fs;

% 【纠错】噪声和阶跃独立命名，不能相互覆盖。
rng(2);
x_noise = 1 + 0.2*randn(N,1);
x_step = ones(size(t));
x_step(t >= 2) = 2;

% 【纠错】数组条件用&；右端不包含1.5 s。
mask = (t >= 0.5) & (t < 1.5);
M = 16;
alpha = 0.1;

y_ma_noise = moving_average_zero(x_noise, M);
[y_iir_noise, ~] = lowpass_block(x_noise, alpha, 0);
y_ma_step = moving_average_zero(x_step, M);
[y_iir_step, ~] = lowpass_block(x_step, alpha, 0);

% 【纠错】只能比较同一含噪输入及其输出，不能使用阶跃输出。
sigma_in = std(x_noise(mask));
sigma_ma = std(y_ma_noise(mask));
sigma_iir = std(y_iir_noise(mask));
reduction_ma = 1-sigma_ma/sigma_in;
reduction_iir = 1-sigma_iir/sigma_in;
mean_ma = mean(y_ma_noise(mask));
mean_iir = mean(y_iir_noise(mask));

rise_ma_ms = step_rise_ms(t, y_ma_step, fs);
rise_iir_ms = step_rise_ms(t, y_iir_step, fs);

fprintf('输入噪声STD：%.6f V\n', sigma_in);
fprintf('MA：STD %.6f V，降低 %.2f%%，均值 %.6f V，上升 %.1f ms\n', ...
    sigma_ma, reduction_ma*100, mean_ma, rise_ma_ms);
fprintf('IIR：STD %.6f V，降低 %.2f%%，均值 %.6f V，上升 %.1f ms\n', ...
    sigma_iir, reduction_iir*100, mean_iir, rise_iir_ms);

plot(t, x_step, 'k-', t, y_ma_step, 'b-', t, y_iir_step, 'r--');
xlim([1.98 2.08]);
xlabel('时间 / s'); ylabel('电压 / V');
legend('输入阶跃', '移动平均', '递归低通'); grid on;

function y = moving_average_zero(x, M)
    y = zeros(size(x));
    for k = 1:numel(x)
        first = max(1, k-M+1);  % 防止索引小于1
        window = x(first:k);
        % 【纠错】固定分母M；不使用numel(window)。
        y(k) = sum(window)/M;
    end
end

function [y, state_out] = lowpass_block(x, alpha, state_in)
    % 【纠错】使用输入参数x、alpha，不能依赖x_noise或写死alpha。
    y = zeros(size(x));
    y_prev = state_in;          % 接续上一块，不在函数内强制清零
    for k = 1:numel(x)
        y(k) = y_prev + alpha*(x(k)-y_prev);
        y_prev = y(k);          % 【纠错】不是y(k-1)
    end
    state_out = y_prev;
end

function rise_ms = step_rise_ms(t, y, fs)
    % 本函数只用于本实验：2 s时从1 V升至2 V。
    k10 = find((t >= 2) & (y >= 1.1), 1, 'first');
    k90 = find((t >= 2) & (y >= 1.9), 1, 'first');
    if isempty(k10) || isempty(k90)
        rise_ms = NaN;          % 未达到阈值，不能记为0 ms
    else
        rise_ms = (k90-k10)/fs*1000;
    end
end
```

## 5. 独立代码练习：整段与分块一致性

以下为已完成练习的整合版。将其单独保存为脚本，与上一段独立运行，勿在同一文件重复定义`lowpass_block`。

```matlab
clear; clc;
n = (0:4000-1)';               % 样本编号，不是采样时间
x = ones(size(n));
x(n >= 2000) = 2;             % 第2001个样本开始为2
alpha = 0.1;

state = 0;
y_block = zeros(size(x));
for first = 1:64:numel(x)
    % 【边界】最后一块32点，min防止越界。
    last = min(first+63, numel(x));
    [y_part, state_next] = lowpass_block(x(first:last), alpha, state);
    y_block(first:last) = y_part;
    state = state_next;        % 【关键】下一块接续上一块最后状态
end

[y_full, ~] = lowpass_block(x, alpha, 0);
y_ref = filter(alpha, [1, -(1-alpha)], x);
err_ref = max(abs(y_full-y_ref));
err_block = max(abs(y_block-y_full));
output_count = numel(y_block);

y_reset = zeros(size(x));
for first = 1:64:numel(x)
    last = min(first+63, numel(x));
    % 故意错误对照：每块重新传入0，观察重复启动的影响。
    [y_part, ~] = lowpass_block(x(first:last), alpha, 0);
    y_reset(first:last) = y_part;
end
err_reset = max(abs(y_reset-y_full));

% 分项输出，避免MATLAB公共指数缩放掩盖微小误差。
fprintf('参考误差：%.3e\n', err_ref);
fprintf('分块误差：%.3e\n', err_block);
fprintf('输出点数：%d\n', output_count);
fprintf('清零状态误差：%.6f V\n', err_reset);

function [y, state_out] = lowpass_block(x, alpha, state_in)
    y = zeros(size(x));
    y_prev = state_in;
    for k = 1:numel(x)
        y(k) = y_prev + alpha*(x(k)-y_prev);
        y_prev = y(k);
    end
    state_out = y_prev;
end
```

提交输出：

```text
1.0e+03 *
    0.0000    0    4.0000    0.0018
```

公共因子1000作用于整行：参考误差显示为0但可能有舍入误差；分块误差0；输出4000点；清零状态最大误差约1.8 V。

原因：输入已稳定为2 V时，清零后的首点输出为`0+0.1*(2-0)=0.2 V`，与正确输出约2 V相差1.8 V。分块本身不改变算法，丢失状态才改变结果。

## 6. 正式问答摘要与评分

| 题目 | 我的回答要点 | 补充/纠正 | 得分 |
|---|---|---|---:|
| 噪声评价区间 | 选择已经稳定的信号 | 应为稳定恒定段；真实阶跃变化也会增大全段STD | 4/5 |
| 移动平均跨块状态 | 保留前15个历史输入 | 上一平均值不足以恢复窗口或确定移除样本 | 4/5 |
| 16点平均的单点尖峰 | 最大偏离1/16 V，影响16点 | 正确，前提为已稳定基线1 V、单点升至2 V | 5/5 |
| 平滑与低延迟参数 | M大、alpha小参考历史更多；低延迟反向调整 | 说“增大响应时间”，避免“减慢延迟” | 5/5 |

| 项目 | 得分 |
|---|---:|
| 实验完成与记录 | 23/25 |
| 原理理解 | 23/25 |
| 正式问答 | 18/20 |
| 独立代码练习 | 25/30 |
| 总分 | **89/100，通过** |

已掌握：两种因果滤波、去噪与响应指标、参数选择、跨块状态传递。需注意：变量命名与输入隔离、统计范围一致、状态更新顺序、浮点阈值和显示精度。测试脚本使用了部分提示。

后续学习原则：集中提交、统一点评；不重复运行已验证内容；严格区分实测、理论推断与未完成项目。

我的代码

```matlab
N=(0:4000-1)';
x = ones(size(N));
mask=(N>=2000);
x(mask)=2;
alpha = 0.1;
state = 0;
y_block = zeros(size(x));

for first = 1:64:numel(x)
    last = min(first+63, numel(x));

    [y_part, state_next] = lowpass_block( ...
        x(first:last), alpha, state);

    y_block(first:last) = y_part;  % 保存本块输出
    state = state_next;               % 下一块使用的状态
end

[y_full, ~] = lowpass_block(x, alpha, 0);
y_ref = filter(alpha, [1, -(1-alpha)], x);

err_ref = max(abs(y_full-y_ref));
err_block = max(abs(y_block-y_full));
output_count = numel(y_block);

y_reset = zeros(size(x));

for first = 1:64:numel(x)
    last = min(first+63, numel(x));
    [y_part, ~] = lowpass_block(x(first:last), alpha, 0);
    y_reset(first:last) = y_part;
end

err_reset = max(abs(y_reset-y_full));

disp([err_ref, err_block, output_count, err_reset]);
function [y, state_out] = lowpass_block(x, alpha, state_in)
y = zeros(size(x));
 y_prev = state_in;

for k = 1:numel(x)
    y(k) = y_prev+alpha*(x(k)-y_prev);
    y_prev =y(k);
end
    state_out=y_prev;
end

```

