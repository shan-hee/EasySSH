# API 接口文档

## 唯一契约源

EasySSH 的 HTTP API 唯一编辑源是 [`shared/openapi.yaml`](../shared/openapi.yaml)，当前使用 OpenAPI 3.0.3。规范包含所有 Gin REST/流式/WebSocket 握手路由，共 219 个操作；路由注册与规范的一致性由 `scripts/check-openapi-routes.mjs` 在生成前检查。

运行时请求参数校验使用同一份嵌入式规范。RBAC 的 `/permissions`、`/roles` 和 `/resource-grants` 路由在进入业务处理器前会校验请求体、路径参数和查询参数。

规范不保留已删除的 `POST /auth/logout` 兼容别名。登出统一使用 `POST /oauth/logout`，因为 refresh token Cookie 的 Path 是 `/api/v1/oauth`。

## 生成代码

从仓库根目录执行：

```bash
./scripts/gen-types.sh
```

该命令依次完成：

1. 检查运行时路由与 OpenAPI 操作是否一一对应，并检查 `operationId` 是否重复。
2. 使用 `server/oapi-codegen.yaml` 和固定版本 `oapi-codegen v2.7.2` 生成 `server/internal/api/openapi/generated.go`。文件包含 Go 模型和嵌入式规范，不应手动编辑。
3. 使用固定在 `web/package.json` 的 `openapi-typescript v7.9.1` 生成 `web/src/types/openapi.ts`。

前端 `web/src/lib/openapi-client.ts` 使用 `openapi-fetch` 创建类型化客户端。认证、CSRF、刷新令牌和账户锁定处理由 `openapiTransportFetch` 提供；客户端不会自动解包或改写响应 JSON。

```typescript
import { openapiClient, requireOpenAPIData, throwOpenAPIError } from "@/lib/openapi-client"

const result = await openapiClient.GET("/roles")
if (result.error) throwOpenAPIError(result.error, result.response)
const roles = requireOpenAPIData(result.data, result.response)
```

路径、HTTP 方法、查询参数、路径参数、请求体和响应体均从 `paths` 类型推导。Blob、SSE、WebSocket 和 multipart 文件请求仍使用 `authenticatedFetch`，但继续复用同一鉴权与刷新实现。

## 认证

登录采用 OAuth 2.0 Authorization Code + PKCE：

- `POST /oauth/authorize` 接收邮箱密码和 S256 PKCE 参数，成功时返回授权码或 2FA 临时令牌。
- `POST /auth/2fa/verify` 在需要 2FA 时完成验证。
- `POST /oauth/token` 使用授权码换取 access token；refresh token 只通过 HttpOnly Cookie 传输。
- 业务请求使用 `Authorization: Bearer <access_token>`。
- `POST /oauth/logout` 撤销当前会话并清理 refresh token Cookie。
- EasySSH 自身登录使用固定内部 issuer/redirect 标识，不依赖浏览器访问域名或部署端口。
- OIDC 标准端点 `/.well-known/openid-configuration`、`/oauth/jwks`、`/oauth/userinfo`、`/oauth/introspect` 和 `/oauth/revoke` 默认关闭；公开地址和开关统一由“系统设置 → 身份认证 → 对外 OAuth/OIDC Provider”管理。

## RBAC

Casbin 角色和资源授权端点：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/permissions` | 查询权限目录 |
| GET/POST | `/roles` | 查询或创建自定义角色 |
| GET/PUT/DELETE | `/roles/{id}` | 查询、修改或删除角色 |
| GET/POST | `/resource-grants` | 查询或授予资源级权限 |
| POST | `/resource-grants/revoke` | 撤销资源级权限 |

角色 `key` 是普通字符串，不再限制为 `admin`、`user`、`viewer`。当前用户响应中的 `permissions` 是 Casbin 计算出的有效权限代码数组。

## 备份 3.0

统一备份端点：

- `GET /backup/export` 导出脱敏备份。
- `POST /backup/export` 接收 `BackupExportRequest`，可选择 `age_passphrase`（Scrypt）或 `age_recipients`（X25519）之一导出敏感段。
- `POST /backup/restore` 以 multipart 上传备份文件，并用 `age_passphrase` 或 `age_identities` 之一解密敏感段。

敏感段使用标准 age ASCII-armored 密文，备份格式版本为 `3.0`。`backup_password` 和旧的自定义 KDF/Envelope 不再存在。

## 路径与部署

规范中的 server URL 为 `/api/v1`，因此完整地址为 `/api/v1/<path>`。开发环境通常设置 `VITE_BACKEND_URL=http://localhost:<后端端口>`；生产环境由后端同源托管前端。

WebSocket、SSE 和文件流端点也在规范中声明了对应的 `101`、`text/event-stream` 或 `application/octet-stream` 响应。它们不应通过 JSON 客户端读取。

## 规范更新流程

1. 修改 `shared/openapi.yaml`，同步请求/响应模型与实际路由。
2. 执行 `./scripts/gen-types.sh`；路由检查失败时先修正契约或路由，不得绕过检查。
3. 在后端处理器中使用 `server/internal/api/openapi` 生成模型；在前端使用 `components`/`paths` 类型和 `openapiClient`。
4. 对 `git diff --check`、`go list`、`go vet` 和 ESLint 做静态检查。

## 参考

- [OpenAPI 3.0.3 规范](https://spec.openapis.org/oas/v3.0.3)
- [openapi-fetch](https://openapi-ts.pages.dev/openapi-fetch/)
- [oapi-codegen](https://github.com/oapi-codegen/oapi-codegen)
