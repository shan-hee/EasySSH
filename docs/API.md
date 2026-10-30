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
