# 实例备份、应用数据迁移与数据库升级

本次开发版本将三条流程分开。完整备份采用 SQLite / PostgreSQL / MySQL 原生能力；JSON 仅用于配置和资源迁移；Goose 负责数据库版本。代码不会自动删除或改造未纳入版本管理的旧开发库，也不再接收 `easyssh-unified-backup` 3.0 文件。

## 适用入口

| 目的 | 入口 | 内容 |
| --- | --- | --- |
| 故障恢复、升级前恢复点 | 系统设置 → 备份与恢复 → 完整备份；应急时使用 `maintenance backup` / `restore` | 原生数据库快照、数据目录、文件传输存储和根密钥 |
| 跨实例或跨数据库搬运资源 | 设置中的数据导出 / 数据导入 | 固定字段契约的 JSON，可选择配置和资源、加密凭据及冲突策略 |
| 修改数据库结构 | `maintenance migrate` | 按编号执行不可变 SQL 迁移 |

通过命令行执行完整备份前，必须先退出正常进程。系统内置入口复用原生快照与归档实现，无需手动停止服务。普通启动与维护共用操作系统文件锁，PostgreSQL/MySQL 还持有数据库会话级锁，避免另一台主机上的 EasySSH 同时写入同一个数据库。这也意味着同一数据库同时运行多个 EasySSH 进程不再受支持。外部 SQL 客户端不会遵守应用锁；维护期间不要用其他工具修改该数据库或文件目录。

命令由已构建的程序提供，不依赖 HTTP 服务是否能够启动。

## 系统内置操作与历史

Web 和桌面端均提供创建、上传、下载、校验、恢复副本、删除、搜索和分页。创建、校验、恢复在后台执行，页面每 3 秒更新状态。备份密码仅存于当前任务内存，不写入历史或日志；每次校验和恢复重新输入密码。

历史记录使用备份目录中的独立 JSON 元数据，包含文件名、时间、大小、来源、状态、错误、版本、校验时间和恢复目录，不占用业务数据库。重启后中断任务标为失败或保留可用文件并显示中断原因。删除操作同时删除归档和历史，保留当前业务数据和已经恢复的副本；正在下载的归档不能删除。

- 服务端默认目录是数据目录旁的 `backups`，可通过 `EASYSSH_BACKUP_DIR` 指定。目录必须与业务数据目录和传输存储互不包含。
- 桌面端默认目录同样为数据目录旁的 `backups`，可通过 `EASYSSH_DESKTOP_BACKUP_DIR` 指定；上传和下载调用系统文件对话框。
- Docker 镜像使用 `/app/backups`；Compose 已增加独立持久化挂载（生产 `./backups`，开发 `./backups-dev`）。应用用户必须对挂载目录有写权限。
- 上传上限为 16 GiB，解压上限为 256 GiB；上传完成仅表示文件已保存，仍需密码校验。临时目录需要容纳解压数据。
- Web 下载使用限定到单个归档的一次性短期票据，由浏览器直接保存，不在页面内存缓存完整文件；下载端点仍检查 `backup:manage` 权限。

服务端备份期间阻止传输文件写入、删除和清理，以及传输存储配置变更；若已有传输或清理正在执行，本次任务显示原因，待任务结束后重新创建。数据库由原生快照提供事务一致性，其他不修改本地附件的服务可继续运行。桌面端收集快照时协调配置、通知、主机指纹文件和日志写入。外部工具修改文件或数据库不受应用锁控制。

**“校验”验证归档校验和、应用形态、数据库类型与版本要求；“恢复副本”才会实际恢复数据库并校验凭据。两者都不表示已切换当前实例。** 恢复副本写入 `backups/restored/<id>-<time>`，页面显示其目录；SQLite 可直接生成副本，PostgreSQL/MySQL 需预先配置 `EASYSSH_RESTORE_DSN` 指向新的空库。当前实现不在线覆盖数据库、不自动修改部署配置或重启服务。通过下文的配置切换流程启用副本。

命令行仍作为无法登录或系统无法启动时的应急入口，不依赖历史列表。旧的手工命令行归档不会自动出现在列表，可通过“上传已有备份”纳入管理。

## 服务端完整备份

1. 停止 EasySSH 服务，保留原有 `DB_DRIVER`、`DB_DSN`、`ENCRYPTION_KEY` 和数据目录配置。
2. 准备只允许操作者读取的密码文件，例如 `/secure/backup-password`。密码不放在命令参数中。
3. 将备份写入数据目录之外：

```sh
./easyssh-api maintenance backup \
  --file /backups/instance.easyssh.age \
  --password-file /secure/backup-password
```

命令检查数据库版本、凭据解密和 SQLite 完整性，创建原生快照，收集数据目录及配置的传输存储，然后流式生成 age 加密的 tar.gz 归档。源文件不允许是符号链接或特殊文件，避免生成缺失外部内容的备份。归档清单记录应用版本、数据库类型和版本、迁移版本、文件长度和 SHA-256。输出文件必须不存在。

SQLite 使用 `VACUUM INTO`，包含已提交的 WAL 内容。不会直接复制运行中的主数据库文件。PostgreSQL 使用 `pg_dump --format=custom`；MySQL 使用 `mysqldump --single-transaction`，要求业务表为 InnoDB。镜像包含 PostgreSQL 和 MariaDB 原生客户端；独立二进制部署需自行安装与数据库版本匹配的客户端。PostgreSQL 的 dump 客户端不能低于源服务端主版本。

MySQL 原生连接支持 unix socket、TCP 和驱动的 `tls=true/false/skip-verify/preferred` 设置；应用自定义注册的 TLS 配置不能自动转成原生客户端配置。MySQL 基线要求 MySQL 8.0.13+，使用表达式默认值；MariaDB 部署须按其版本验证相应 SQL 和客户端兼容性。

默认数据目录：SQLite 为数据库文件所在目录，PostgreSQL/MySQL 为 `EASYSSH_DATA_DIR`，未配置时为当前工作目录下的 `data`。备份根密钥使用应用实际加载的值，即使它来自 `ENCRYPTION_KEY` 环境变量也会加密保存。数据库连接口令不写进备份，恢复时由目标部署提供。反向代理、容器编排和外部服务配置仍由部署管理，不属于应用数据目录。

## 检查和恢复

```sh
./easyssh-api maintenance inspect \
  --file /backups/instance.easyssh.age \
  --password-file /secure/backup-password

./easyssh-api maintenance restore \
  --file /backups/instance.easyssh.age \
  --password-file /secure/backup-password \
  --into /srv/easyssh-restored
```

`inspect` 会解密、读取并核对所有文件。需要足够的临时磁盘空间；归档解压上限为 256 GiB。它验证归档完整性，不代替数据库恢复演练。

`restore` 要求 `--into` 不存在。流程如下：

1. 在权限受限的临时目录解密并核对清单，拒绝重复路径、路径穿越、符号链接和多余内容。
2. 检查应用版本与迁移版本；拒绝把较新备份恢复到旧程序。
3. SQLite 恢复到临时数据库；PostgreSQL/MySQL 恢复到操作者提供的空数据库。
4. 执行该程序支持的后续迁移，验证根密钥能够解密应用凭据；SQLite 另检查数据库与外键完整性。
5. 清理登录会话、设备授权和短期认证请求，防止旧快照复活已撤销授权；保留资源及同步文档。传输文件路径调整为恢复目录内的 `transfers`。
6. 把恢复完成的文件发布到新目录，输出该目录。**不会自动替换原实例或启动服务。**

SQLite 切换时，将 `DB_DSN` 设置为 `/srv/easyssh-restored/easyssh.db`。保留旧目录，即可在停止新实例后切回。根密钥从恢复目录的 `easyssh-root.key` 读取；必须取消旧的 `ENCRYPTION_KEY` 覆盖，或确保它与恢复密钥完全相同。

PostgreSQL/MySQL 恢复前，创建独立空数据库，并通过 `EASYSSH_RESTORE_DSN` 环境变量提供相应的 Go 驱动 DSN。可以用 `--target-dsn-env OTHER_VARIABLE` 指定其他环境变量名。恢复后将正常服务的 `DB_DSN` 指向该数据库，将 `EASYSSH_DATA_DIR` 指向恢复目录，并使用恢复根密钥。原数据库保持保留。

PostgreSQL 的原生导入使用单事务；MySQL DDL 无法保证整体事务回滚。若 MySQL 导入失败，目标是隔离的新数据库，原实例不受影响；删除失败的临时目标库并重新创建空库后再重试。程序不会擅自清空数据库。

完整备份只在同一数据库类型、同一应用形态内恢复。服务端与桌面端之间、SQLite 与 PostgreSQL 之间的数据搬运使用 JSON。

## Docker

先准备宿主机备份目录和密码文件，确保容器中的应用用户有适当权限。在 `docker` 目录使用项目的 Compose 配置：

```sh
docker compose stop easyssh
docker compose run --rm --no-deps \
  -v /srv/backups:/backups \
  -v /srv/secrets/backup-password:/run/secrets/backup-password:ro \
  easyssh ./easyssh-api maintenance backup \
  --file /backups/instance.easyssh.age \
  --password-file /run/secrets/backup-password
docker compose start easyssh
```

恢复时将新的宿主机父目录挂载进维护容器，把 `--into` 指向该挂载下尚不存在的子目录。确认成功后再修改正常服务的数据卷或数据库连接。Compose 管理的现有数据卷不要在恢复命令中直接覆盖。

## 桌面端

完整退出应用（仅关闭窗口可能仍在托盘运行），使用桌面程序同样的子命令：

```sh
EasySSHDesktop maintenance backup --file /backups/desktop.easyssh.age --password-file /secure/backup-password
EasySSHDesktop maintenance inspect --file /backups/desktop.easyssh.age --password-file /secure/backup-password
EasySSHDesktop maintenance restore --file /backups/desktop.easyssh.age --password-file /secure/backup-password --into /new/desktop-data
```

Windows 使用实际的 `.exe` 路径；macOS 使用应用包内的可执行文件路径。命令在 Wails 和界面启动之前执行。

默认数据目录仍为可执行文件旁的 `data`；可通过 `EASYSSH_DESKTOP_DATA_DIR` 指定恢复目录。完整备份加密保存系统凭据库中的根密钥。恢复时会检查数据库凭据、同步对象和代理密码；只有系统凭据库为空或已有相同密钥时才允许安装。若系统账号已有另一实例的根密钥，在独立系统账号恢复，避免破坏原实例。恢复后的设备同步需要重新授权。

## JSON 应用数据

格式为 `easyssh-application-data`，版本为 `1.0`；敏感段版本为 `1`。导出字段来自 `shared/backuputil/contract.go` 的明确契约，不再从来源库自动收集字段。JSON 最大 32 MiB。

服务端支持系统设置、安全策略、通知配置、系统/个人 AI 配置、用户资料、服务器、脚本、SSH 密钥、主机指纹、角色权限和计划配置。桌面端支持服务器、脚本和 SSH 密钥；来源用户标识用于保持资源引用，导入桌面端时归属本地账号。不支持的桌面端资源会在预览中列出。

账号登录密码、MFA 密钥、备份码、登录会话、同步设备授权、执行日志、任务执行状态和 AI 会话历史不属于 JSON 应用数据。需要保留整个实例时使用原生备份。新导入的用户没有可直接使用的登录密码，需由管理员设置；现有用户登录凭据保持原值。

导入顺序：解码与版本校验 → 解密并验证敏感段绑定摘要 → 过滤废弃或额外的普通字段 → 检查必要字段和 SSH 密钥归属 → 预览 → 用户确认 → 事务导入。被忽略字段同时从列清单与记录中移除，并列入结果；身份字段和资源引用缺失会报错。预览后实际数据可能变化，提交时重新检查冲突。

服务端预览执行查询，不分配数据库序列；桌面端预览在 SQLite 事务内执行完整导入路径后回滚，不修改通知文件或执行后台任务。前端展示新增、覆盖、跳过以及忽略项，再请求确认。

当前格式不提供旧通用备份转换器。开发环境按新契约重新导出或建立新数据；不要通过只修改旧文件的版本号绕过格式检查。

## 数据库版本与开发流程

迁移文件位于 `shared/dbmigration/server/{sqlite,postgres,mysql}` 和 `shared/dbmigration/desktop/sqlite`。版本由 Goose 的 `goose_db_version` 表记录。初始迁移包含当前应用表、索引与约束，并已移除废弃 GeoIP 字段。

新空库从 `00001_initial.sql` 初始化。普通启动仅允许当前迁移版本，已有库需要升级时会提示使用维护命令，不执行持续的 `AutoMigrate`。Casbin 的自动建表也已关闭。

未纳入迁移管理的旧开发库会被拒绝，原数据不变。不要仅手工插入版本号冒充已经完成初始化；本开发版本没有旧库接入兼容层。保留旧数据库和匹配版本的程序供旧数据读取，另建新开发库。

后续每次结构变更：

1. 修改业务模型，并为每个支持的数据库增加下一个编号的 SQL 文件，禁止改写已发布迁移。
2. 增加 `dbmigration.Latest`，更新受影响的应用数据字段契约；语义不兼容的 JSON 变化提升格式版本。
3. 停止应用，用新程序执行维护升级：

```sh
./easyssh-api maintenance migrate \
  --file /backups/before-upgrade.easyssh.age \
  --password-file /secure/backup-password
```

已有版本数据库确实需要升级时，此命令先创建完整恢复点，成功后才执行迁移。空库初始化或没有待执行迁移时不需要生成恢复点。桌面端使用同样的参数。

SQLite/PostgreSQL 的迁移默认事务执行；MySQL 初始 DDL 标记为非事务迁移。修改失败不要伪造完成版本。涉及破坏性数据变更时，使用完整恢复点恢复到隔离目标并切换；不提供假定能够找回已删数据的通用 `migrate-down` 命令。

## 发布前验证

在测试环境验证三种数据库的新库初始化、加密备份恢复、版本升级、失败回退、桌面凭据库恢复及 JSON 导入预览。归档校验成功不代表数据库恢复和程序启动已经完成演练。
