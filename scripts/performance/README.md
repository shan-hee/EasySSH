# 终端真实连接性能测试

原有终端性能测试通过正常登录后的浏览器会话连接已有的 **PVE-Debian 13**。原有终端性能脚本不会模拟 SSH、监控、Docker 或 SFTP 响应，也不会执行远程文件写入、容器控制或 AI 推理。终端输出测试使用 `printf` 输出 300 行。后文的页签/SFTP专项包含明确列出的故障注入和临时文件读写，需在已授权测试的主机上运行。

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

## 页签、合并工作空间和 SFTP 专项审查

这些脚本需手动执行，用于审查和修复回归，不自动加入默认测试套件。

复用上述 Playwright、正常登录 storageState 和回环发布代理。发布产物必须对应待审查代码；本轮代理为 5200。按顺序单独运行，每个进程退出后再执行下一项：

```bash
PERF_ORIGIN=http://localhost:5200 PERF_AUTH_STATE=/your/private/storage-state.json node scripts/performance/tabs-sftp-audit.mjs
PERF_ORIGIN=http://localhost:5200 PERF_AUTH_STATE=/your/private/storage-state.json node scripts/performance/tabs-sftp-workspace-audit.mjs
PERF_ORIGIN=http://localhost:5200 PERF_AUTH_STATE=/your/private/storage-state.json node scripts/performance/tabs-sftp-extra-audit.mjs
PERF_ORIGIN=http://localhost:5200 PERF_AUTH_STATE=/your/private/storage-state.json node scripts/performance/tabs-sftp-state-regression.mjs
PERF_ORIGIN=http://localhost:5200 PERF_AUTH_STATE=/your/private/storage-state.json node scripts/performance/tabs-sftp-transfer-audit.mjs
PERF_ORIGIN=http://localhost:5200 PERF_AUTH_STATE=/your/private/storage-state.json node scripts/performance/tabs-sftp-perf.mjs
```

- `AUDIT_OUTPUT_DIR` 默认 `/tmp/easyssh-tabs-audit`，提前创建目录；默认认证文件为该目录下的 `auth-state.json`。脚本退出会更新自己的认证状态文件，必须是测试专用副本。
- `AUDIT_SERVER` 默认 `PVE-Debian 13`。跨服务器脚本的 `AUDIT_SECOND_SERVER` 默认 `PVE`，必须是另一台已获用户授权的主机。脚本按精确名称选择第二主机。
- `tabs-sftp-audit.mjs` 检查首页、页签保持、拖动排序/合并、菜单、关闭等；`tabs-sftp-workspace-audit.mjs` 对焦点、拆回、关闭和连接标记单独复核。
- `tabs-sftp-extra-audit.mjs` 注入服务器列表500，以及延迟真实目录响应1800ms；同时测试窄屏、大目录、上传/下载/编辑。`AUDIT_FILES_ONLY=1` 仅执行文件操作。默认整段输入验证保存链路；`AUDIT_TYPING_DELAY=80` 改为80ms/键，复核逐键输入异常。
- 文件测试只在 `/tmp/easyssh-tabs-audit-<UUID>` 中创建数据，finally 通过正常认证API删除自己的目录。跨服务器脚本在两台测试主机创建独立临时目录，上传约64KiB二进制文件、双向传输并逐字节核验。没有同名覆盖或大文件压力测试。
- Web 终端页已开启跨会话拖放；默认模式验证真实拖放、完成状态、自动刷新和文件内容。`AUDIT_TRANSFER_MODE=api` 使用同一登录会话的正常API启动直连传输、正常票据订阅WebSocket完成状态，再手动刷新和回读字节；此模式不代表UI拖放通过。
- 若进程被强制终止，finally可能无法执行。用报告的 `remoteScratchPath` 和指定测试主机恢复清理，只删除该次UUID目录；清理后核验目录不存在。不要泛化删除其他 `/tmp` 内容。
- `tabs-sftp-perf.mjs` 采集64个窗口，覆盖普通切换、弹窗开关、工作空间往返，分别1x/4x CPU；含rAF帧间隔、长任务、目录/关闭请求和GC后内存抽样。请求失败与秒级延迟保留在 `directoryResponses`，不能只看是否fatal。
- 脚本将断言失败记录在 JSON；功能失败、fatal 或临时目录清理未通过时返回非零退出码。审核仍需检查 `checks[].passed`、`fatal` 和清理状态。
- 不复制全页截图到公开报告，截图可能含账户或其他主机信息；认证文件不得入库。认证恢复失败时先通过正常UI重新登录，已中断记录保留，不计为业务通过。

工作空间布局已迁移至 Dockview，原自写布局算法及对应的 `split-layout-audit.test.ts` 已移除。历史报告中的 7 项结果仅对应迁移前实现，不代表 Dockview 集成验证。浏览器脚本使用 `data-dockview-session-id` 定位工作空间页签标题。

`tabs-sftp-state-regression.mjs` 还验证独立/内嵌 SFTP 的未保存草稿在普通页签、合并和拆回期间保留，隐藏编辑器快捷键隔离、固定页签保护、主目录解析和上次目录恢复。此脚本同样仅操作本次 UUID 临时目录。

### 工作空间成熟库集成检查

`workspace-libraries-audit.mjs` 配合 `web/test/fixtures/workspace-libraries.html`，在正在运行的 Web 开发服务上检查真实 Dockview、React portal 和 Pragmatic 拖放适配器。测试数据均为本地模拟会话，无需登录，不连接测试主机、不上传或移动远端文件。

```bash
EASYSSH_BASE_URL=http://localhost:3000 \
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
CHROMIUM_PATH=/path/to/chrome \
AUDIT_REPORT=/tmp/workspace-libraries.json \
node scripts/performance/workspace-libraries-audit.mjs
```

覆盖加载样式区分、两页签合并、嵌套分屏、尺寸保存、同组页签切换、编辑草稿与会话实例保留、固定页签键盘关闭保护、拆回普通页签、拖回加号、单成员折叠、布局恢复、文件移动/跨会话拖放的单次触发，以及编辑器关闭后文件浏览区重新接收外部文件。另覆盖独立分区工具栏、同组切换工具栏、内嵌工具栏隔离、关闭按钮固定最右侧并关闭对应会话、合并预览及虚线包含标题区域，共 19 项检查。失败时返回非零退出码。

结果仅证明前端库集成；真实 SSH/SFTP 链路与性能采样仍使用前述独立脚本，不能把本地模拟传输记为真实主机传输通过。
