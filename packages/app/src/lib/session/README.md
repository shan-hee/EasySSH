# Session Core Boundary

`packages/app/src/lib/session` 是 SSH/SFTP Workspace 的会话与传输内核，收拢连接身份类型、纯 SFTP 目录加载逻辑、SFTP 操作内核，以及可注入的 Workspace 合约。工作区核心文件不依赖具体 Web 传输实现，由 `pnpm check:boundaries` 约束。

## 纯内核

- `types.ts`：终端与 SFTP 会话共享的服务器连接身份类型。
- `terminal-types.ts`：终端运行时类型，包括可注入的 WebSocket URL resolver 与 WebSocket 构造器。
- `sftp-directory.ts`：目录列表归一化逻辑，支持显式注入 `api`。
- `sftp-directory-source.ts`：带租约的目录数据源，供多个视图共享同一目录的加载结果。
- `sftp-operations.ts`：删除、创建、重命名、保存、批量删除等 SFTP 操作的共享执行逻辑，使用显式 `notifier`、`setFiles` 和 `api` 注入。
- `sftp-session-api.ts`：Workspace 级 SFTP API 合约（`SftpSessionApi`），聚合认证、目录加载、文件操作、读写、上传下载、跨服务器传输、chmod 和传输任务查询；`assertCompleteSftpSessionApi` 检查宿主是否提供了全部方法。
- `workspace-settings.ts`：SFTP 批量下载排除规则的默认值与解析逻辑；宿主通过 `settings.sftp.downloadExcludePatterns` 注入，不把整套系统设置放入 Workspace。
- `transfer-tasks.ts`：上传、下载、跨服务器传输任务对象的构造，后端传输任务到列表项 update 的映射，以及任务进度合并。
- `transfer-controller.ts`：传输任务数组的状态控制 helper，集中处理恢复任务合并、追加/更新/删除、活跃/完成任务筛选和取消标记；`useFileTransfer` 与 `transfer-manager-controller.ts` 复用这些规则。
- `transfer-runtime.ts`：上传并发 limiter，限制同时从本机发送的上传数量，其余按提交顺序排队。
- `transfer-manager-controller.ts`：非 React 的传输 controller，组合 SFTP API 与上传 limiter，承接任务恢复、上传/下载/批量下载/文件夹上传的发起、取消和失败重试。任务进度通过每秒查询一次传输任务获得，不使用 WebSocket；`useFileTransfer` 主要负责 React 状态持有。
- `workspace.ts`：Workspace 的能力声明、终端/SFTP 会话快照、传输任务、传输历史、session controller 和宿主 adapter 合约。其中 `apiClient.sftp` 提供 Workspace 内的 SFTP 实现，`settings.sftp.downloadExcludePatterns` 承接批量下载排除规则，`preferences` 承接工作台内部的小型 UI 偏好，`theme.mode` 与 `theme.terminalTheme` 可覆盖终端渲染明暗模式和主题名，`transferManager.history` 承接基于统一操作记录的传输历史读取，`sessionController` 承接终端/SFTP 会话激活、关闭和重置，`notifier.action` 承接带操作按钮的提示，`authTicketProvider` 与 `apiClient.terminal.createWebSocketUrl` 决定终端 WebSocket 的票据和地址，`apiClient.terminal.saveVerifiedCredential` 承接终端补充凭据保存。
- `workspace-adapters.ts`：i18n、notifier、settings、preferences、auth ticket provider 和 session store/controller 到 Workspace adapter 的轻量适配工厂，避免页面反复手写 adapter 对象；`createBrowserWorkspacePreferenceAdapter` 把浏览器存储包装为窄接口，`createCompositeWorkspaceSessionStoreAdapter` 与 `createCompositeWorkspaceSessionController` 组合终端与 SFTP 两类会话。
- `cross-session-file-drag.ts`、`split-pane-drag.ts`：跨会话文件拖拽与分屏拖拽的数据标记。

## Web 适配

- `web-workspace-adapters.ts`：把 Web 的操作记录与审计日志接口映射为 Workspace 的传输历史和活动记录 adapter。它依赖 `@/lib/api`，不属于工作区核心。

## 使用约定

`performXxx` SFTP 操作函数通过显式传入 `notifier`、翻译函数和文件列表更新器复用，可以被任意宿主组合。

`TerminalWebSocket`（`lib/websocket-terminal.ts`）支持注入 ticket provider、WebSocket URL resolver 和 WebSocket 构造器，`WebTerminal` 从 Workspace 的 auth/api/theme adapters 取得这些依赖。

终端内文件管理器的 `useSftpSession` 接收 SFTP API、notifier 和 i18n 翻译函数；`TabTerminalContent` 从 Workspace 的 `apiClient.sftp`、`notifier`、`i18n` 和 `authTicketProvider` 派生这些依赖。文件管理以终端页内的标签呈现，Web 的 `/dashboard/sftp` 只是跳转到终端页的入口。SFTP UI 文案通过 Workspace `i18n` adapter 解析，批量下载排除规则通过 `settings` adapter 注入，SFTP 视图模式和终端内文件面板宽度通过 `preferences` adapter 持久化。

导航、Dashboard 侧边栏、Runtime Profile 判断、设置、服务器选择器、权限等宿主专属依赖应继续留在本目录外。Workspace 只通过 adapters 或 capabilities 消费这些能力。
