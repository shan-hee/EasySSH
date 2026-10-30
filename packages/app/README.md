# @easyssh/app

Web 与桌面共用的前端应用主体。两端只保留平台启动、认证接入、传输适配和窗口能力，功能视图、工作区、组件与交互流程由本包提供。

## 引用方式

- 包内代码使用 `@/` 表示本包的 `src`，不跨出本包。
- Web 与桌面只通过 `package.json` 的 `exports` 引用本包，例如 `@easyssh/app/components/ui/button`、`@easyssh/app/desktop`；不得使用 `@/` 或相对路径进入本包。
- 消费方编译本包源码需要的解析配置由本包提供：TypeScript 继承 `@easyssh/app/tsconfig.consumer.json`，Vite 使用 `@easyssh/app/vite` 中的 `appSourceAliases` 与 `appSingletonDependencies`。
- 样式入口为 `@easyssh/app/styles/globals.css`，消费方在自己的样式文件中导入，并用 `@source` 声明自身源码目录。

当前导出表对应两端已有的引用，属于过渡期的公开面；随着两端接入相同根组件，导出会收敛到少量入口。新增导出时只加入宿主确实需要的模块。

## 入口

- `@easyssh/app/desktop`：桌面壳挂载工作区所需的根组件、上下文、设置与能力 helper、适配器类型，以及强制本地语义的 `LogsClient`、`ScriptsPage`、`BackupRestoreTab` 包装。
- 其余子路径与 `src` 下的模块路径一致。

## 工作区

- `workbench/use-workbench-sessions`：终端会话与文件标签的编排（新建、关闭、复制、固定、排序与空闲提醒）。终端会话保存在终端 store 中，平台通过参数提供文件能力开关、空闲提醒上限和连接建立后的回调。
- `workbench/workbench`：两端共用的终端与文件工作台视图；连接通道、服务器配置与工具栏右侧操作由宿主传入。
- `workbench/workspace-shell`：视图宿主。工作台始终挂载，进入过的完整视图默认保留状态，切换视图不重建连接、不中断传输。
- `workbench/ai-workspace`：AI 工作内容，会话列表作为视图内的可折叠栏，不依赖全局侧边导航。

两端都以工作台作为主界面，不设常驻侧边导航：工作台标签栏右侧放置 AI 入口、应用菜单和少量全局操作，其他功能作为完整视图从应用菜单进入，视图页头提供返回工作台。Web 的外壳组合位于 `web/src/layouts/dashboard-layout.tsx` 与 `web/src/shell`，由于页面依赖路由查询参数，Web 只保活工作台与 AI，其余页面随路由挂载。

## 平台接入

本包不保存凭据，也不决定请求发往哪里。宿主在挂载应用前注入 `contracts/platform-transport` 中的 `PlatformTransport`：

- API 与 WebSocket 地址、附加凭据的请求、需要新鲜凭据的二进制或流式请求、XHR 使用的访问令牌，以及凭据状态订阅。
- Web 的实现位于 `web/src/platform`，负责 access_token 内存存储、refresh_token Cookie 刷新、CSRF、空闲超时以及认证失效后的跳转。
- 桌面本地工作区通过适配器访问本机服务，不注入平台传输；误用 HTTP 客户端会直接报错，而不是把请求发往错误的来源。桌面接收分享时注入远端实例的实现。

`lib/api-client` 只负责协议层：拼接地址、JSON 编解码、重试与统一错误结构。系统配置与客户端认证的上下文定义在本包，Web 以所有者会话查询提供实现，桌面使用 `StaticSystemConfigProvider` 与 `StaticClientAuthProvider`。

## 边界检查

在仓库根目录执行 `pnpm check:boundaries`，规则位于 `tooling/frontend/check-import-boundaries.ts`：

- 本包不得导入 Wails、宿主应用源码或以路径引用其他包。
- 工作区核心（会话、传输与适配器契约）不得依赖 Web API 客户端或平台传输。
- Web 与桌面只能通过包导出引用本包；桌面不得引用 Web 页面和 Web API 客户端。
- `@easyssh/sync-document` 不导入任何模块，Automerge 由各宿主注入。

## 测试

单元测试位于 `test/`，在本目录执行 `pnpm test`，或在仓库根目录执行 `pnpm test` 运行全部前端包测试。
