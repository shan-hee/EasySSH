# EasySSH 内置 Wails 补丁清单

更新：2026-10-30。

桌面 `go.mod` 声明 `github.com/wailsapp/wails/v3 v3.0.0-alpha.97`，通过 replace 使用本目录。本清单描述个人工作区重构相对仓库原有 Wails 副本的改动，不将该副本视为未修改的上游发行包。升级时需同时保留原有平台修订，不能只按版本号覆盖整个目录。

## 补丁目的与宿主接线

Wails 的 Go 绑定在应用级注册。独立窗口本身不隔离 Go 能力，因此分享窗口必须由原生来源决定身份，在分发调用前限制能力，同时隔离事件、浏览器存储和导航。

宿主在 `desktop/EasySSHDesktop/main.go` 注册 NativeRuntimePolicy、NativeEventPolicy、NativeMessagePolicy；`desktopnativeboundary.go` 保存宿主创建的 WindowID 到工作区的映射及允许调用的方法。业务规则仍在宿主，运行时只提供可信来源和策略执行点。本目录不得导入 `github.com/easyssh/*`。

## 文件与行为

下列路径均相对本目录。

| 补丁 | 文件 | 必须保留的行为 |
| --- | --- | --- |
| 原生请求来源 | `internal/runtimeorigin/context.go`、`internal/assetserver/assetserver_webview.go`、`pkg/application/application.go` | 由实际原生 WebView 请求向 Go context 注入 WindowID；HTTP 头、绑定参数和 ClientID 不能建立来源身份。 |
| 运行时策略入口 | `pkg/application/application_options.go`、`pkg/application/runtime_policy.go` | 暴露三个宿主策略及 RuntimeWindowID；缺少原生来源时拒绝。策略判断采用宿主来源和解析后的绑定 FQN。 |
| 调用与取消隔离 | `pkg/application/messageprocessor.go`、`pkg/application/messageprocessor_call.go`、`pkg/application/window_manager.go` | 目标窗口固定为调用者，拒绝跨窗口选择；名称、方法 ID、别名都在解析后授权；取消按 WindowID + callID 隔离，移除窗口时取消其在途调用。日志不记录绑定参数和结果正文。 |
| HTTP 运行时与分块 | `pkg/application/transport_http.go` | HTTP 请求必须具备原生来源；分块按窗口和请求 ID 隔离，限制数量/大小/寿命，重复块不重复计量，完成标记避免重复分派；响应 no-store。这里是 Wails 的请求传输，不是业务正文读取协议。 |
| 通用窗口边界 | `pkg/application/webview_window.go`、`pkg/application/webview_window_options.go`、`pkg/application/navigation_policy.go` | 增加 RestrictNavigation/IsolatedStorage；创建时固定资源来源，SetURL 和原生导航都校验；事件投递按接收窗口过滤；关闭文件拖放时不发送本机路径。 |
| macOS | `pkg/application/application_darwin.go`、`pkg/application/webview_window_darwin.go`、`pkg/application/webview_window_darwin.m` | 原生消息带主框架来源信息；WKWebView 导航代理执行限制，隔离窗口使用非持久 websiteDataStore。 |
| Windows | `pkg/application/navigation_policy_windows.go`、`pkg/application/webview_window_windows.go` | WebView2 拦截主框架、子框架导航及新窗口；隔离窗口使用独立临时 DataPath，关闭控制器后清理；事件处理器保持引用，安装失败不继续开放窗口。 |
| Linux GTK4 / cgo | `pkg/application/linux_cgo.go`、`pkg/application/linux_cgo.c`、`pkg/application/linux_cgo.h` | 隔离窗口使用 ephemeral network session；构造函数将 session 传入 WebView；decide-policy 执行导航限制。Go/C 声明须一起更新。 |
| Linux GTK3 / cgo | `pkg/application/linux_cgo_gtk3.go` | 独立 ephemeral context，每个隔离 context 注册资源 scheme；decide-policy 执行导航限制。 |
| Linux purego | `pkg/application/linux_purego.go` | 隔离 context；scheme 回调从实际请求的 WebView 查 WindowID，不能捕获第一个窗口 ID；关闭窗口删除映射；注册导航回调。 |
| 边界验证源码 | `pkg/application/runtime_policy_test.go` | 覆盖伪造窗口信息、名称/ID/别名调用、跨窗口取消、伪造 HTTP 头、外部导航和子框架拒绝。 |

Linux WebKitGTK 的部分回调不能提供完整主框架标识，现有实现拒绝命名目标/新窗口，并要求宿主 CSP 使用 `frame-src 'none'`。升级时须保留这项配合，不能将未知框架直接解释为可信主框架。

`pkg/updater/helper.go` 的 EasySSH protocol 导入属于误加内容，已删除，不是需要重放的补丁。原有 `gtkdispatch_linux*.go` 等平台适配不属于本轮来源隔离增量，升级时仍应对照整个已提交副本检查。

## 升级步骤

1. 记录当前已提交的 Wails 副本、声明版本和目标上游版本。先比较整个副本与旧上游，再查看上游变更；不要用当前未提交工作区作为可恢复的唯一补丁备份。
2. 按“来源 context → 分发策略 → 调用/取消 → HTTP 传输 → 窗口/平台接线”顺序移植。上游若已提供等价能力，改接上游实现并删除重复补丁，避免保留两套权限判断。
3. 同步核对宿主 internal/app/app.go、internal/app/desktopnativeboundary.go、internal/app/desktopremoteworkspace.go 的接线；确认远端窗口仍不获得本机网关令牌，策略仍以原生来源而非前端参数授权。
4. 逐项核对三个原生平台及 Linux GTK3/GTK4、cgo/purego 路径，尤其是回调签名、COM ABI、导航安装时序和存储分区创建时序。所有文档加载前都应完成隔离接线。
5. 更新本清单、声明版本和 replace，删除被上游替代的本地代码。需要运行验证时，遵照项目约定先取得用户明确的构建/测试指令。

## 后续运行验证范围

本清单是源码说明，不是测试通过记录，也不授权自动运行测试。当前修复未执行构建、go vet 或测试。获准验证时至少覆盖：

- `runtime_policy_test.go` 的来源与分发用例，以及宿主远端窗口相关用例。
- 真实 macOS、Windows、Linux 窗口：本机与两个分享来源并存，Cookie/localStorage 不串用，关闭重开不复用隔离数据。
- 名称/ID/别名调用本机敏感方法、跨窗口取消、伪造 HTTP 头及分块请求均不能绕过边界；完成块重放不重复执行。
- 外部导航、子框架、弹窗与拖放的限制；本机窗口正常操作不受分享窗口权限影响。
- 本机事件不广播给分享窗口；窗口关闭取消调用且释放临时存储，日志没有令牌、凭据或正文。
