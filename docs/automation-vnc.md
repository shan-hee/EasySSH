# MCP、访问令牌与远程桌面

EasySSH 提供 Web noVNC、可选 guacd 网关的 RDP，以及外部 Agent 使用的 MCP Streamable HTTP。noVNC 无需额外网关；RDP 需要单独的 guacd 进程或容器。SPICE 入口已移除。目标机器仍须提供相应的 VNC/RDP 服务；本次没有增加 SSH 隧道或跳板转发。

## 访问令牌

访问令牌是凭据，MCP 是使用凭据的入口，二者合并在主页侧边栏“开放与自动化”分组下的 **MCP 接入**（`/dashboard/mcp`）页面：上方是连接地址和常见客户端（Codex、Claude Code、Cursor、VS Code、通用）的配置片段，下方是令牌列表，“创建令牌”按钮位于访问令牌区域的标题右侧，可用工具目录默认折叠。Codex 配置写入 `~/.codex/config.toml`，已有 `[mcp_servers.easyssh]` 时更新原配置段。旧的 `/dashboard/access-tokens`、`settings?section=mcp` 和 `settings?section=access-tokens` 地址均跳转到该页面。

在 **MCP 接入** 页面点击“创建令牌”，在侧边抽屉中选择用途和服务器范围；同一套权限应用到所有选中的服务器，后端仍在同一事务中创建机器授权与令牌。也可在“高级设置”中选择已有授权，保留原 `grant_id` 签发方式。创建成功后，抽屉直接给出已填入令牌的客户端配置片段，复制即可接入。机器授权不会生成分享链接，不出现在分享管理列表中；浏览器分享兑换和生成分享链接接口均拒绝该类授权。界面默认 30 天，最多 365 天，实际期限不超过授权有效期。令牌原文只返回一次，服务端只保存 SHA-256 哈希；不要将令牌放进 URL、脚本仓库或日志。

```http
Authorization: Bearer <ess_api_令牌>
```

创建令牌按使用场景提供四种预设：

| 用途 | 默认允许 | 默认不包含 |
| --- | --- | --- |
| 只读巡检 | 系统/容器读取、目录浏览、文本读取 | 命令执行、文件写入/删除 |
| 文件维护 | 浏览、读取、上传、下载、写入文件 | 文件删除、任意命令 |
| 运行指定脚本 | 系统读取、明确选定版本和参数范围的脚本执行 | 任意命令 |
| 命令运维 | 任意命令、系统/容器读取、目录浏览、文件读取/写入 | 不自动勾选其他工具权限；Shell 本身仍有远端账号的实际权限 |

服务器范围使用一个可搜索的多选框，可按分组整组选择，也可按名称、地址、分组或标签搜索单台服务器。按分组选择时只加入当下的成员，后续新增成员不会自动扩展令牌权限。单个令牌最多包含 100 台明确服务器，超限会提示且不截断选择。

创建界面不再提供单台差异调整：需要不同权限的服务器请分别创建令牌。脚本版本和参数约束配置一次即应用到所有选中服务器；脚本修改后必须重新确认版本。令牌名称可留空自动生成，有效期可选 7/30/90/180/365 天（默认 30 天），并发连接数默认 4，放在“高级设置”中。

令牌保存在新增的 `automation_tokens` 表。浏览器/桌面访客会话仍使用原来的 `access_sessions` 表及其原有约束。运行任务时，令牌的稳定 ID 作为执行会话身份，复用 Grant 的资源范围、连接版本、脚本版本、参数限制、字节配额及运行时撤销机制。自动化令牌不适用访客的 30 分钟空闲回收或 12 小时会话期限。

- 令牌可操作已授权的服务器资源，不能调用 Owner 专属的服务器配置管理、系统设置、备份等接口。
- 修改授权或重新生成分享链接会改变授权版本，旧令牌失效，需要重新签发。
- 修改服务器连接目标或 VNC/RDP 配置会暂停该资源的旧授权，需要所有者确认目标；令牌不会自动批准新目标。
- 撤销令牌会拒绝后续请求，取消关联运行工作。已产生的远端效果不会回滚，脱离 SSH 会话的远端进程不保证被终止。
- 最多签发 100 个当前有效令牌；列表最多显示 500 条，优先显示有效令牌。授权选择器按页加载现有分享授权。
- 轮换采用“签发新令牌 → 更新客户端 → 撤销旧令牌”，不会重新展示旧令牌。
- 恢复完整备份时清除自动化令牌，并撤销恢复出的授权，避免恢复已失效的访问凭证。
- 令牌与 VNC/RDP 配置属于实例配置，不参与现有桌面配置同步。

## MCP 与 REST

入口：**主页侧边栏 → 开放与自动化 → MCP 接入**。页面展示接入步骤、可复制的通用连接参数和从 `GET /api/v1/automation/tools` 读取的实际工具目录。工具名称、功能说明和参数说明支持中英文；协议标识保留用于核对，原始 JSON 定义放在折叠区。工具范围、参数类型、必填项和数值约束仍以服务端返回的实际定义为准；列出工具不代表拥有执行权限。签发后先复制保存令牌，再进入 MCP 页面配置客户端。

MCP 地址：`https://<实例域名>/api/v1/mcp`。使用 Streamable HTTP，并配置 Bearer 请求头。当前提供无状态 JSON 响应，不维护 MCP 会话；GET SSE 订阅和 DELETE 会话关闭返回 405。没有实现 OAuth 授权发现，客户端必须支持手动设置访问令牌。

MCP 不需要内置 AI 配置，也不创建内置 AI 对话。SDK 负责 MCP 协议，业务适配层负责输入验证和调用已有服务；工具权限由服务端 Scope 检查，客户端不能通过工具参数提升权限。

| 工具 | 权限与行为 |
| --- | --- |
| `list_servers` / `get_server_info` | 仅返回授权范围内的服务器 |
| `get_system_info` | `monitor.read` |
| `list_directory` / `read_file` | `files.list` / `files.read` |
| `write_file` | 同时需要 `files.read` 与 `files.write`；复用文本文件快照与写入前冲突检查 |
| `create_directory` / `delete_file` | `files.write` / `files.delete`；删除目录包含其子目录 |
| `list_scripts` | 列出指定服务器允许的脚本、版本和参数限制；支持 `limit` / `after_id` 分页 |
| `execute_command` | `terminal.connect`；提交持久化任务 |
| `execute_script` | `scripts.execute`，且脚本版本及参数符合授权；提交持久化任务 |
| `get_task` / `cancel_task` | 查询/取消该执行身份的任务，不能借任务 ID 访问别人的任务 |

任意命令执行拥有远端账号实际具备的系统权限。只读令牌不要授权 `terminal.connect`；关闭文件写入工具不能限制 Shell 的写入能力。

相同工具可通过 `POST /api/v1/automation/tools/{name}` 调用，JSON body 为工具参数。例如：

```http
POST /api/v1/automation/tools/execute_command
Authorization: Bearer <令牌>
Content-Type: application/json

{"server_id":"<服务器 UUID>","command":"uptime"}
```

成功返回 `task_id`，再调用 `get_task` 获取状态与输出。网络断开或结果未知时先核对远端状态，不自动重试有副作用的请求。工具参数上限 1 MiB；MCP 请求体上限 2 MiB。非队列工具有 60 秒服务端超时；文件读取和输出继续使用已有工具的大小限制。

配置修改及工具操作会保存归属记录。令牌名称可以从令牌管理页面对应到记录中的会话 ID；命令与脚本沿用任务中心的执行记录。日志不保存令牌原文和 VNC 密码。

## noVNC

在终端页签栏选择 **VNC**，选择服务器，启用 VNC 并保存独立端口，然后连接。目标主机使用该服务器已经保存的 Host，浏览器不能指定任意代理地址。已有 SSH 配置不变。

连接过程：创建 `vnc` 逻辑连接 → 签发绑定服务器、身份与连接 ID 的 `ws_vnc` 一次性票据 → 打开二进制 WebSocket → 后端 TCP/TLS 转发。断开页签、令牌/分享撤销、会话过期会关闭代理连接。网络转发具有帧大小和写入超时限制，浏览器与代理保持心跳。

界面支持画面、鼠标键盘、缩放、全屏、Ctrl+Alt+Del、文本剪贴板、断开及手动重连。VNC 分享使用独立的 `vnc.connect` 权限；接收者必须自行输入目标 VNC 凭证。文本剪贴板通过输入框查看/发送，不会自动覆盖系统剪贴板。文件传输继续使用 SFTP。

VNC 密码只用于浏览器中的本次认证，不保存到数据库、URL 或本地存储。当前不提供“隐藏 VNC 密码的自动登录分享”。TLS 开关表示后端到目标端口采用直接 TLS 封装，并验证系统 CA 与目标 Host；它不等同于浏览器 WSS，也不代表所有 VNC 服务内置的 VeNCrypt 模式。后者仍由 noVNC 与目标服务协商，能否连接取决于双方支持的认证方式。

连接记录描述代理传输的建立与关闭，不代表后端已经验证远端桌面登录成功；登录结果由 noVNC 显示。VNC 配置不包含密码。

## 可选 RDP 网关

连接链路：浏览器 Guacamole 客户端 → EasySSH 的票据认证 WebSocket → guacd → 目标 RDP 服务。浏览器和后端使用逐条指令的 JSON 隧道，后端负责 Guacamole 协议编解码；客户端不能提交任意 guacd 连接参数或更改目标 Host。

基础安装不依赖 guacd。独立部署时，在服务端环境中设置：

```env
GUACD_ADDRESS=127.0.0.1:4822
GUACD_TLS=false
```

`GUACD_ADDRESS` 为空时 RDP 不启用，连接窗口显示配置提示。修改网关环境配置后需重启服务端。`GUACD_TLS=true` 要求 guacd 已配置 TLS，并使用系统信任的证书；EasySSH 会验证证书和网关主机名。

guacd 本身没有应用层身份验证，只应允许 EasySSH 服务端访问。示例 Compose 不将 4822 发布到宿主机，且仅给需要 RDP 的部署启用额外容器。网关配置集中在 `docker/docker-compose.yml`，默认注释关闭；需要 RDP 时，同时取消 `GUACD_ADDRESS`、`GUACD_TLS`、`depends_on` 及整个 `guacd` 服务块的注释，再在 `docker` 目录执行：

```sh
docker compose up -d
```

开发配置 `docker-compose.dev.yml` 同样包含默认注释的网关配置，无需额外覆盖文件。网关使用固定版本 `guacamole/guacd:1.6.0`，浏览器客户端使用 `guacamole-common-js:1.5.0` 的 ESM 发布包，握手协商 Guacamole 1.5.0。部署前应按实际 RDP 主机完成兼容性验收；本次没有自动拉取或启动 guacd。

在终端选择 **RDP**，选择已有服务器并保存 RDP 配置。目标 Host 沿用服务器资源，默认端口 3389；默认使用 NLA，可显式选择 TLS。默认验证 RDP 服务证书，对已人工确认的自签名目标可以显式允许未验证证书。该设置修改也会递增服务器连接版本并中断相关连接，分享与令牌需要重新确认目标。

用户名、密码和可选域名只在票据认证成功后的第一帧提交，不进入 URL、数据库或本地存储。浏览器至 EasySSH 应通过 HTTPS/WSS；跨主机网关链路应使用受信网络或 TLS。密码只在本次连接的进程内存中使用；断开后重新连接需要再次输入。

当前提供画面、键鼠输入、按窗口缩放、全屏、Ctrl+Alt+Del、文本剪贴板与手动重连；初始桌面分辨率限制为 320×200 至 3840×2160，剪贴板限制为 64 Ki 字符。未启用音频、麦克风、磁盘映射、打印机、录屏或文件传输；文件操作继续使用现有 SFTP 功能。RDP 分享使用独立 `rdp.connect` 权限，接收者自行输入目标账号。

## 生产升级：schema 5/6 → 7

schema 6 新增 `automation_tokens` 和 `server_vnc_configs`；schema 7 新增 `server_rdp_configs`，并为 `grants` 新增 `purpose` 字段，默认值为 `share`，保留所有旧字段和既有授权语义。新建机器授权复用既有 Grant 表，以 `purpose=automation` 区分用途；旧授权签发令牌的 API 仍兼容。普通启动默认先创建加密恢复点，再自动升级 schema 5/6。更早的数据库版本不在本次升级范围内。

1. 保留原实例根密钥、数据与备份目录、部署配置；停止旧 EasySSH 进程，并阻止外部工具写入同一数据库。
2. 更新并启动新版本。服务会自动预检、创建升级恢复点、逐版迁移和校验，全部成功后开放 HTTP 和后台任务，不必每次手动执行 SQL。
3. 日志会给出恢复点路径和升级结果。普通启动超时与迁移超时分开处理，默认迁移总上限 30 分钟。原 Cookie、访客访问及同步凭证的格式不变。

完整行为、开关、历史外键异常处理及恢复命令见[服务端启动自动迁移](backup-and-migrations.md#服务端启动自动迁移)。离线 `maintenance schema-upgrade` 仍保留，并使用相同的升级恢复点流程；`EASYSSH_AUTO_MIGRATE=off` 仅关闭普通启动的自动升级。空库仍可正常初始化；从完整 schema 5/6 备份恢复到新副本时，在隔离副本中迁移到 schema 7，再清理访问凭证。

完整 SQL（各文件包含 Up 和 Down）：

- schema 7：[SQLite](../server/internal/storage/schema/sqlite/00007_rdp.sql)、[PostgreSQL](../server/internal/storage/schema/postgres/00007_rdp.sql)、[MySQL](../server/internal/storage/schema/mysql/00007_rdp.sql)。
- schema 6：[SQLite](../server/internal/storage/schema/sqlite/00006_automation_vnc.sql)、[PostgreSQL](../server/internal/storage/schema/postgres/00006_automation_vnc.sql)、[MySQL](../server/internal/storage/schema/mysql/00006_automation_vnc.sql)。

SQLite/PostgreSQL 由 Goose 将每个迁移文件及其版本记录放在同一事务内执行，失败自动回滚。MySQL DDL 隐式提交，不能承诺整体事务回滚：Up 使用可重入建表，schema 7 通过临时存储过程检查并增加用途字段，自动迁移中断后须先检查结构，必要时恢复到干净的已记录版本，再显式 `maintenance schema-upgrade --resume`；Down 通过补偿 DDL 撤销新增表。Down 的授权数据变更在存储过程中开启事务，并用异常处理器执行 `ROLLBACK`/`RESIGNAL`，因此 MySQL 升级及回退账户还需创建/执行/删除临时存储过程的权限。

不要把整个 SQL 文件当作普通 SQL 一次执行，因为其中包含 Up 与 Down；使用维护命令让 Goose 选择方向和管理版本记录。

## 回退

停止新服务后，使用新可执行文件执行：

```sh
./easyssh-api maintenance schema-rollback
```

每次命令只回退一个版本：7 → 6 删除 RDP 配置和新增的用途字段，并撤销 RDP 默认内容授权与新建的机器用途授权；已有分享授权所签发的令牌、VNC 配置及 SSH/SFTP 数据保留。需要回到 schema 5 时，再执行一次命令（6 → 5），删除 VNC 配置和自动化令牌，并撤销 VNC 默认内容授权。然后启动对应版本的旧程序。其他授权中的新增桌面动作在旧程序中不会被接受。回退前如需保留新功能数据，先使用新版本创建完整备份。MySQL 中断回退后可以重新执行；如升级/回退状态无法确认，使用升级前完整备份恢复副本。

## 待执行的验收

本次实现不自动构建或运行测试。自动迁移新增 SQLite 历史异常保留、恢复点复用/损坏拒绝、备份失败阻止 DDL、关闭开关及启动器心跳期限的回归用例，均尚未运行。已添加令牌隔离、哈希存储、权限限制、后台任务身份恢复、撤销、授权版本失效、内联授权原子性，以及网关协议边界的回归用例，实际运行需另行安排。

发布前应在生产副本完成：三种数据库的 5 → 6 → 7 → 6 → 5 迁移、旧登录/分享/同步回归、真实 MCP 客户端初始化及工具调用、授权内外资源隔离、任务撤销，以及真实 VNC/RDP 服务的认证、键盘鼠标、剪贴板、断线和多页签连接。RDP 还应覆盖 guacd 未配置、不可达、NLA、域账号、证书校验及授权撤销。此文不代表这些运行验证已完成。
