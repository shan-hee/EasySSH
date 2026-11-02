# API 接口文档

## 唯一契约源

EasySSH 的 HTTP API 唯一编辑源是 [`contracts/http/openapi.yaml`](../contracts/http/openapi.yaml)，当前使用 OpenAPI 3.0.3。协议源已归入 `contracts/http`，监控源归入 `contracts/proto/metrics.proto`。当前正按个人工作区模型收敛契约，现存规范及生成物尚未全部反映新的运行时接口；不能将现有生成类型视为已经完成的接口交接。

`scripts/check-openapi-routes.mjs` 核对 REST、流式和 WebSocket 握手路由的方法与路径，并检查 operationId。带中间件参数的路由组也必须计入；无法解析的路由组直接报错。该检查不证明请求、响应模型正确，模型仍需逐接口与处理器核对。

## 生成代码

从仓库根目录执行：

```bash
./scripts/gen-types.sh
```

该命令依次完成：

1. 检查运行时路由与 OpenAPI 操作是否一一对应，并检查 `operationId` 是否重复。
2. 使用固定版本 `oapi-codegen v2.7.2`，按 `contracts/http/go-models.yaml` 生成服务端和桌面共用的 `shared/protocol/generated.go`。生成文件不应手动编辑。不再生成无运行消费者的嵌入规范包。
3. 使用 `packages/app/package.json` 声明、由根 `pnpm-lock.yaml` 锁定版本的 `openapi-typescript` 生成 `packages/app/src/generated/openapi.ts`。

可以传 `--go` 只生成两端共用的 Go 模型，或传 `--ts` 只生成前端类型；两者仍要求路由检查通过。当前后端工作不更新前端类型。

前端 `packages/app/src/lib/openapi-client.ts` 使用 `openapi-fetch` 创建类型化客户端。客户端经由宿主注入的平台传输发送请求：Web 的认证、CSRF、刷新令牌和账户锁定处理位于 `web/src/platform/http-transport.ts`；客户端不会自动解包或改写响应 JSON。

```typescript
import { getOpenAPIClient, requireOpenAPIData, throwOpenAPIError } from "@/lib/openapi-client"

const result = await getOpenAPIClient().GET("/servers")
if (result.error) throwOpenAPIError(result.error, result.response)
const servers = requireOpenAPIData(result.data, result.response)
```

路径、HTTP 方法、查询参数、路径参数、请求体和响应体均从 `paths` 类型推导。Blob、SSE、WebSocket 和 multipart 文件请求仍使用 `authenticatedFetch`，但继续复用同一鉴权与刷新实现。

## 浏览器会话与反向代理

所有者管理写请求使用 HttpOnly / SameSite=Strict 会话 Cookie，并强制验证 `X-CSRF-Token`；不再额外比对 Origin 与后端连接协议。`POST /owner/login` 和 `POST /owner/initialize` 仅接受 `application/json`（可带 charset 参数），缺失、格式错误或其他 Content-Type 返回 415 `unsupported_media_type`，阻止跨站简单表单请求；跨来源 JSON 请求仍须通过 CORS 预检。

WebSocket 入口必须消费绑定端点、资源与访问主体的一次性 ticket；创建 ticket 的写请求仍需通过会话/访问凭据及相应 CSRF 校验。握手不再依赖反代后的协议来判断 Origin。

`WebSecurityConfig` 和更新接口已移除 `csrf_trusted_origins`，额外 HTTP CORS 来源仍通过独立 CORS 设置维护。

系统基本配置已移除 `public_url`。`POST /grants` 和 `POST /grants/{id}/rotate-secret` 返回的 `link` 为 `/share/{public_id}#secret` 相对地址；Web 在显示和复制时使用 `window.location.origin` 补全协议、域名及端口。API 调用者须使用对应实例的 Web 来源补全，不能直接把相对地址当作完整分享链接。现有分享 ID 和密钥不变，已发出的绝对链接仍指向原来的域名。

分享工作区先展示服务器主页，沿用桌面工作台的搜索、网格／列表布局和会话标签栏；顶部独立展示分享名称、到期时间及退出入口。双击服务器按 `default_content` 打开获授权的默认功能，也可通过卡片操作选择其他已授权功能。单台服务器不再自动连接；新增、编辑、删除及所有者分组信息不向访客开放。

访客首次兑换及携带访客 Cookie 的写请求要求 `Origin` 与请求的对外来源一致，并拒绝 `Sec-Fetch-Site: cross-site`；后续写请求继续校验 CSRF Token。对外来源从请求 Host 和 TLS 推导；只有连接对端在现有可信代理列表内，才读取 `X-Forwarded-Proto` 和 `X-Forwarded-Host`。反向代理必须覆盖客户端传入的这些头，并保留外部 Host（含非默认端口），或通过 `X-Forwarded-Host` 传递。CORS 同步识别该对外来源，无需为同源分享额外配置固定域名。

## 飞书聊天接入（后端）

飞书复用 `/chat-connections` 的管理、启停、绑定、会话和审批接口，使用企业自建应用及官方 SDK 长连接，无需公网 Webhook。创建连接的请求体示例：

```json
{
  "provider": "feishu",
  "name": "运维助手",
  "app_id": "cli_your_application_id",
  "app_secret": "your_application_secret",
  "server_ids": ["实际服务器 UUID"],
  "permission_mode": "balanced",
  "enabled": true
}
```

以上请求发送到 `POST /api/v1/chat-connections`，使用现有 Owner 登录和 CSRF 机制。`app_secret` 仅写入，按连接 ID 加密保存；更新时留空保留原密钥。创建时省略 `provider` 仍使用 Telegram，更新时省略则保留原平台。已有连接不能切换平台或飞书 App ID，应新建连接。Telegram 的 `token`、返回字段和绑定链接继续有效。

飞书开放平台的配置步骤：

1. 创建企业自建应用，启用机器人能力，并确保使用者处于应用可用范围。
2. 申请接收机器人单聊消息权限 `im:message.p2p_msg:readonly` 和发送机器人消息权限 `im:message:send_as_bot`，按开放平台要求发布应用版本。
3. 在“事件与回调”中选择长连接，订阅 `im.message.receive_v1`。需要审批按钮时，同时配置卡片回调 `card.action.trigger` 的长连接接收。后端启用连接后会建立连接；若控制台要求先检测连接，可先保存并启用后端配置，再完成订阅。
4. 调用 `POST /api/v1/chat-connections/{id}/bind-code`，打开返回的 `url` 进入机器人私聊，发送返回的 `command`（`/bind <code>`）。飞书打开机器人链接不会自动携带绑定码；绑定码有效期为 10 分钟且只能使用一次。
5. 私聊发送文字。支持 `/help`、`/new`、`/status`、`/stop`，不接收群聊指令。`readonly` 限制只读，`balanced` 的执行操作需通过卡片审批，审批有效期为 10 分钟。

飞书身份保存在 `external_user_id`（用户 open_id）中；原有 `user_id` 字段保留，飞书绑定的该值为 `"0"`。显示名称暂使用 open_id，无需申请额外的通讯录读取权限。`last_poll_at` 在飞书连接上表示最近的在线心跳。

回复使用飞书消息卡片，第一段结果替换本次提问的“已收到，正在处理。”，长回复继续分段发送。临时提示消息 ID 与发送队列仍保存在内存中，进程重启后新产生的结果会另发消息。长连接重连及事件重发通过数据库去重；事件在调用 Agent 前记录，崩溃可能丢失尚未处理的消息，但不会重放已记录的事件。飞书出站消息重试复用发送 UUID，降低网络重试造成的重复消息。

生产升级与回滚见 [备份与迁移](backup-and-migrations.md)。本次仅提供后端接口，现有前端未增加飞书配置入口。

## 认证与授权

实例使用单一 Owner。初始化、登录、登出、双因素认证、资料及会话管理位于 `/owner`；不提供用户注册、角色管理、OAuth/OIDC Provider 或多用户管理接口。

访客通过 `/access/exchanges` 交换分享凭据，浏览器使用受保护 Cookie，桌面原生侧持有限定来源的访问令牌。`/grants` 由 Owner 管理授权；`/connections` 管理当前访问范围内的逻辑连接。路由动作声明与执行租约负责服务端授权，生成的协议类型本身不授予权限。

桌面、浏览器和服务端应从唯一契约生成传输类型。后端使用 `shared/protocol`；前端生成物和平台传输尚需对接，不能由旧类型检查通过推断接口一致。原 `shared/accessprotocol` 已移除，仅桌面消费的链接解析位于 `desktop/EasySSHDesktop/internal/accesslink`；权限运行时仅位于 `server/internal/access`。请求/响应模型、错误码及认证细节以规范为准。

运行时未安装通用 OpenAPI 请求校验中间件，输入校验由各处理器及服务执行，授权由动作声明和访问作用域执行。路由/生成物一致性检查不等同运行时请求校验。

AIUIMessage、AIServerReference 直接由契约生成，手写 aichatui 包消费这些类型；生成包不反向导入领域包。消息 parts 是契约描述的开放 JSON 对象，用于保留 AI SDK 扩展字段。通知响应以 owner_id 标识所有者，前端需同步该字段；SyncIdentity 的 user_id 未在本轮改名。

## 会话与未登录页面

所有者会话使用安全设置中的 `session_timeout` 作为空闲超时分钟数；成功的 Cookie 认证 HTTP 请求续期，后台轮询也计入。`remember_login` 只允许持久保存 Cookie，不绕过超时。持久 Cookie 随认证响应刷新，普通 Cookie 不含 Expires/Max-Age。WebSocket 消息本身不续期，持续连接沿用逻辑连接 HTTP 心跳。配置变更在下一次会话校验时应用；已到期会话不能通过调大超时恢复。

登录页使用匿名 `GET /public/branding` 获取 `system_name`、`system_logo`、`system_favicon`、`default_language`，响应是直接对象。完整 `GET /settings/system` 继续要求所有者身份。

依赖逻辑连接的 SFTP、Docker 和系统探测请求必须带 `X-EasySSH-Connection`。浏览器 WebSocket 通过一次性 ticket 绑定连接，无需自定义该头；若提供则必须与票据匹配。该头已加入 CORS 允许列表。

浏览器终端旁的监控使用同一服务器已连接终端的逻辑连接签发 `ws_monitor` 票据，不额外占用分享的连接名额，仍独立校验 `monitor.read`。没有可用终端时，独立监控创建自己的逻辑连接。浏览器取消握手或关闭独立流时主动释放所创建的连接，避免等待空闲回收；监控子流关闭不会释放终端的连接。

`GET /scripts` 返回 `{data, total, page, page_size, total_pages}`，Script 含版本、标签、执行次数及作者。`GET /notifications` 返回 `{notifications, unread_count, total, page, page_size, total_pages}`，没有 data 包装。前端应按各自契约读取，不能统一解包 data。

## 完整备份与设备同步

整体恢复使用加密原生归档，管理接口要求 `backup:manage` 权限：

- `GET /backup/instances` 查询备份历史与恢复能力。
- `POST /backup/instances` 使用密码创建完整备份。
- `POST /backup/instances/upload` 上传已有加密归档。
- `GET /backup/instances/{id}/download` 使用一次性下载票据下载归档。
- `POST /backup/instances/{id}/inspect`、`POST /backup/instances/{id}/restore` 分别校验归档、恢复独立副本。
- `POST /backup/instances/{id}/activate`、`POST /backup/activation/rollback` 在支持启动器时启用副本或切回上一实例。
- `DELETE /backup/instances/{id}` 删除归档及历史，不删除当前实例或已恢复副本。

归档只支持同应用形态、同数据库类型并满足版本要求的恢复。通用 JSON 数据导出、预览、导入接口及对应请求模型已移除。

日常跨端使用 `/sync` 下的账户授权和设备同步接口。桌面通过浏览器授权后交换本人服务器配置、自定义排序及脚本；凭据、个人 AI 配置和 AI 历史需单独授权并开启。同步权限与完整备份管理权限分开，数据范围及恢复步骤见[实例备份、设备同步与新库初始化](backup-and-migrations.md)。

## 路径与部署

规范中的 server URL 为 `/api/v1`，因此完整地址为 `/api/v1/<path>`。开发环境通常设置 `VITE_BACKEND_URL=http://localhost:<后端端口>`；生产环境由后端同源托管前端。

WebSocket、SSE 和文件流端点也在规范中声明了对应的 `101`、`text/event-stream` 或 `application/octet-stream` 响应。它们不应通过 JSON 客户端读取。

## 规范更新流程

1. 修改 `contracts/http/openapi.yaml`，同步请求/响应模型与实际路由。
2. 执行 `./scripts/gen-types.sh`；路由检查失败时先修正契约或路由，不得绕过检查。
3. 在服务端处理器和桌面客户端中使用 `shared/protocol` 生成模型；在前端使用 `components`/`paths` 类型和 `getOpenAPIClient()`。
4. 对 `git diff --check`、`go list`、`go vet` 和 ESLint 做静态检查。

## 参考

- [OpenAPI 3.0.3 规范](https://spec.openapis.org/oas/v3.0.3)
- [openapi-fetch](https://openapi-ts.pages.dev/openapi-fetch/)
- [oapi-codegen](https://github.com/oapi-codegen/oapi-codegen)
