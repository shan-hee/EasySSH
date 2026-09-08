# 终端真实连接性能测试

测试通过正常登录后的浏览器会话连接已有的 **PVE-Debian 13**。不会模拟 SSH、监控、Docker 或 SFTP 响应，也不会执行远程文件写入、容器控制或 AI 推理。终端输出测试使用 `printf` 输出 300 行。

## 环境

- 独立安装 Playwright，并提供 `PLAYWRIGHT_MODULE`（其 `index.mjs` 的绝对路径）和 `CHROMIUM_PATH`。不需要修改应用依赖。
- Web 后端运行于 `localhost:8520`。发布构建由测试代理在独立端口提供，API 和 WebSocket 转发到真实后端。
- `PERF_AUTH_STATE` 指向通过正常 UI 登录得到的 Playwright `storageState` JSON。它含认证 Cookie，必须保存在仓库外并设为 `0600`；不要提交或放入报告。
- 串行执行性能场景。不要同时构建、跑单元测试或启动第二个性能浏览器。
- 代理仅绑定回环地址，并将来源映射为已有开发前端 `http://localhost:3000`，沿用后端开发来源配置和完整认证。它不是生产部署服务器。

## 发布构建与场景

在 `web` 目录执行：

```bash
pnpm exec vite build --outDir /tmp/easyssh-terminal-perf/baseline-dist
```

在仓库根目录，单独启动代理：

```bash
node scripts/performance/serve-release.mjs /tmp/easyssh-terminal-perf/baseline-dist 5198
```

再运行：

```bash
PERF_ORIGIN=http://localhost:5198 \
PERF_AUTH_STATE=/your/private/storage-state.json \
PERF_OUTPUT=/tmp/easyssh-terminal-perf/baseline.json \
node scripts/performance/terminal-perf.mjs
```

默认测试 5 次冷资源缓存连接、5 次热资源缓存连接；普通 CPU 与 4 倍 CPU 降速各执行 6 轮菜单开关。菜单包括监控、文件管理器、AI 助手、延迟、Docker、设置和全屏，共 168 个操作窗口，另测 12 秒稳定监控及终端输出。

- `PERF_ROUNDS`：每组连接数量，默认 5。
- `PERF_MENU_ROUNDS`：每档 CPU 的菜单循环数量，默认 6。
- `PERF_CACHES`：`cold,warm`、`cold` 或 `warm`。
- `PERF_WARMUP=1`：先建立一次不计入正式统计的预热连接。用于独立运行热缓存组。
- `PERF_CONTEXT_MENU=1`：额外测量普通会话右键菜单开关，共增加 24 个窗口。修复前该菜单因触发器事件未传递而不可用，不能作为有效的动画基线。
- 每轮都会落盘。中断记录不会自动被当作成功样本；汇总时必须保留异常说明，不得无说明删除慢样本。
- 热缓存只表示浏览器资源缓存，绝不表示 SSH 连接已复用。

优化后构建到另一个目录，用另一个代理端口运行同样场景。脚本会将本地存储来源映射到对应测试端口；Cookie 仍使用正常会话。

## 功能、复用与后端稳定采样

```bash
PERF_ORIGIN=http://localhost:5200 \
PERF_AUTH_STATE=/your/private/storage-state.json \
PERF_BACKEND_PID=12345 \
PERF_OUTPUT=/tmp/easyssh-terminal-perf/functional.json \
node scripts/performance/terminal-functional.mjs
```

覆盖图表实例复用、关闭时持续采样、SFTP 根目录与刷新、Docker 只读页签、AI 面板、双终端页签与共享监控、30 秒持续采集、响应式布局和减少动态效果偏好。`PERF_BACKEND_PID` 可选；提供后读取 Linux `/proc` 的 CPU ticks、RSS 和线程数。CPU ticks 换算应采用宿主机 `getconf CLK_TCK`，CPU 百分比按一个逻辑核口径计算。

## Motion 对照

在 `web` 目录构建独立入口（正常应用构建不包含它）：

```bash
pnpm exec vite build --config ../scripts/performance/vite-motion.config.mjs
```

启动代理并运行：

```bash
node scripts/performance/serve-release.mjs /tmp/easyssh-terminal-perf/motion-dist 5199
node scripts/performance/motion-perf.mjs
```

参考入口使用真实 `motion/react`、项目的 180ms 时长和缓动曲线。它是轻量参考面板，用于确定相同浏览器的帧调度水平，不代表和完整终端页面有相同工作量。

## 指标口径与限制

- `terminal-probe.js` 在应用代码前注入，记录 rAF 时间、Long Tasks、Event Timing、WebSocket 控制消息类型和监控包的少量指标。不会记录密码、Cookie、WebSocket URL 查询串或终端输出正文。
- 帧间隔统计覆盖点击前开始、操作后至少 550ms 的窗口。操作完成、采集和序列化可能使窗口略长；帧间隔包含主线程和软件图形栈的综合影响。
- Event Timing 有浏览器阈值与量化限制；这里是实验室交互样本，**不是生产 INP**。
- `chartPaintOpportunity` 是检测到图表 canvas 后的第二次 rAF，表示已经获得绘制机会，**不是 ECharts 完整动画结束时间，也不是屏幕光学测量**。
- 前后端使用各自的持续时间，避免直接比较不同机器的绝对时钟。`sshLatencyMs` 使用已有 Web 采集器口径，包含命令 session 建立和执行。
- 新账号会话、资源缓存、目标主机状态、软件 GPU 和宿主机负载都可能影响结果。报告必须声明拓扑、浏览器、样本数、原始异常和未覆盖范围。
- 测试结束后关闭代理，删除私有认证文件；保留脱敏测量数据和报告。

## 第二轮：设置、AI、尺寸同步与监控更新

`terminal-panels-check.mjs` 使用真实服务器进行专项检查；`PERF_VERIFY=1` 会断言 AI 消息区实例复用、焦点、字体调整后的远端 PTY 尺寸。尺寸通过仅输出分隔符和 `stty size` 的只读命令核对，脚本不保存终端正文。

```bash
PERF_ORIGIN=http://localhost:5200 \
PERF_AUTH_STATE=/your/private/storage-state.json \
PERF_VERIFY=1 \
PERF_OUTPUT=/tmp/easyssh-terminal-round2/panels-after.json \
node scripts/performance/terminal-panels-check.mjs
```

专项脚本对样式读取做计数，因此与正式帧间隔测试分开运行，不把诊断窗口当作性能基准。正式比较继续使用 `terminal-perf.mjs`，通过 `PERF_CACHES=warm PERF_ROUNDS=1 PERF_CONTEXT_MENU=1` 对两个独立发布构建各采集 192 个菜单窗口；这一轮用于已连接后的交互比较，不用于重新估算连接 P95。

两个脚本在独立测试 context 中移除 `tab-ui-storage`，以默认面板展开状态开始，避免中断批次的面板状态污染下一轮。不会清理用户正常浏览器的存储。专项脚本会恢复拖动前的宽度和字体设置；它不执行 AI 推理。

第二轮汇总器读取同一目录中的 `before.json`、`after.json`、`panels-before.json`、`panels-after.json`：

```bash
node scripts/performance/summarize-panels.mjs /tmp/easyssh-terminal-round2
```

同机资源限制：类型检查、lint、构建和浏览器采样必须串行执行。工具返回仍在运行的 session 时应继续等待退出，不能启动下一项。第二轮末次补测因违反这一约束造成主机资源争抢并中断，报告保留该记录。

`PERF_DIAGNOSTICS_ONLY=1` 只运行设置和 AI 实例诊断，不进行尺寸操作；适合对旧版本保留对照数据。`PERF_VERIFY=1` 是新版本完整专项断言。
