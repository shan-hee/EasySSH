# EasySSH Desktop

EasySSH Desktop is the Wails v3 shell for the embeddable SSH/SFTP workspace. The desktop home screen keeps the web terminal workspace shape, while moving dashboard navigation and administration concerns out of the first window.

## Scope

- Wails v3 desktop shell with a compact SSH/SFTP workspace first screen.
- Runtime bridge for platform, version, capability, and data directory information.
- Icon entry points for desktop-only controls such as theme and workspace settings.
- Local single-user task management with run history, progress events, cancellation, retry, cleanup, retention, and linked notifications.
- Production metadata for Windows, macOS, and Linux build assets.

## Product Boundary

Desktop shares the core EasySSH workspace capabilities with Web: SSH terminal, SFTP, file transfers, scripts, task management, monitoring, Docker helpers, AI assistant, activity logs, and local backup/restore. The task-management UI is shared with Web, while Desktop stores runs and events in its own local SQLite tables under the `local_owner` identity and never reads or writes the Web task API. Portable backups include task runs, task events, and linked notifications; active task snapshots restore as interrupted failures because execution contexts cannot be resumed on another process.

Desktop is a single-user local app. It should use `local_owner` / `owner` runtime semantics and local data-owner markers when Web-shaped data requires a `user_id`, but it must not introduce the Web user-management system. Keep these Web-only concerns out of Desktop unless a future product decision explicitly changes the boundary:

- Login/session management, registration, OAuth, 2FA, account lockout, and notification preferences.
- User, role, permission, audit, login-log, security-policy, rate-limit, and IP-allowlist administration.
- Server-side organization settings, multi-user governance, scheduled automation pages, and organization-level background task controls. Desktop task management is limited to locally executed operations and intentionally excludes Web schedules.

When Desktop reuses Web components, prefer adapter props such as `desktopMode` and runtime capabilities to keep the visible UI local and personal. Web-compatible backup fields such as the synthetic `users` table are compatibility shims, not a Desktop user model.

## Build

From this directory:

```bash
PATH="$(go env GOPATH)/bin:$PATH" wails3 task windows:build ARCH=amd64
```

The Windows amd64 executable is written to `bin/EasySSH.exe`. The GitHub Release asset is `EasySSH-windows-amd64-desktop.zip`.

The release zip contains a single top-level `EasySSH.exe`. The same asset is used for manual downloads and desktop one-click updates.

Desktop data is stored in the `data` folder next to the desktop executable. The app creates that folder on startup when it does not exist.

## Layout

- `main.go`: Wails application entry point and main window configuration.
- `desktopservice.go`: Desktop runtime bridge exposed to the frontend.
- `frontend/`: React/Vite workspace shell UI.
- `build/`: Wails platform build assets and packaging metadata.

## Device sync

The desktop **Data & sync** page contains synchronization and local backup/restore. Its header switch pauses/resumes this desktop; the matching Web account-settings switch pauses/resumes all device sync requests for that account. Enter the server origin and a device name, then sign in using the system browser. Check the verification code and approve the displayed account before returning to the desktop app. Approval requests expire after five minutes. HTTPS is required, except for localhost development. Web device management lives in **Account settings → Data & sync**; system backup/restore remains in system settings. Device credentials expire after 90 days. Bidirectional synchronization requires `server:manage`, independently of `backup:manage`; any signed-in Web user can view and revoke their own devices. The default ordinary-user role does not include `server:manage`, so an administrator must grant the existing resource permission before that user can authorize bidirectional sync.

Desktop runs Automerge 3.5.0 as JS/WASM in its WebView. Go continues to own SQLite, SSH, SFTP, and execution. The server uses the same shared document implementation through a private Node.js stdio worker. The desktop executable does not require Node.js or a new CGO dependency.

Synchronization runs on application startup, network recovery, focus, and every 15 seconds while the application is running. It includes server connection settings, groups, tags, and scripts. Browser authorization separately grants server credentials, personal AI configuration/API keys, and AI conversation history. Each additional scope starts disabled on the desktop, including after reconnecting. Shared system AI keys, account/device tokens, live terminal handles and execution grants are excluded. Without the credentials scope, new connections require locally configured credentials. A received change to a connection's address/authentication bundle clears that connection's locally saved password/key association to avoid using a credential against a different target.

The first connection receives remote records without enrolling existing local data. Newly created or imported local records remain local until explicitly selected in **Choose data to sync**. Selecting a local record assigns it to the active space; selecting a record from another space makes a new metadata-only copy without its password or private-key association. The original remains in its original space. Groups and tags are attributes of the selected servers/scripts, not separate shared collections.

A space is derived from the persistent server instance UUID and user UUID. `desktop_sync_spaces` retains each space's document, acknowledged heads and last-sync time; `desktop_sync_records` maps remote records to fresh local primary keys. `desktop_sync_state` holds only the active binding, encrypted device credential, enabled flag and CAS revision. Remote identifiers never directly overwrite local primary keys. Only the active space participates in an exchange. Offline records from all spaces remain usable locally, and their edits are reconciled when that same space is reconnected.

Independent fields merge automatically. Connection parameters and script contents are atomic values; concurrent values can be reviewed in the sync page. Deletions propagate within their original space. Signing out removes the local credential and attempts to revoke it remotely, while preserving ownership and sync history. If remote revocation cannot be confirmed, the UI directs the user to revoke the device in Web account settings. Signing into another account never transfers the previous space's records. Sync history, ownership mappings and device grants are excluded from portable backups. New records restored from a backup remain local; explicitly overwriting an already-enrolled local record updates that record in its existing space.

Supplementary documents contain only random immutable-payload references; passwords, private keys, API keys and conversation bodies do not enter Automerge history or the Node worker. Go transfers payloads over HTTPS and encrypts sync objects at rest on both ends. Existing AI history tables keep their existing storage policy. This is a trusted-server design, not end-to-end encryption: the server can decrypt data. Private-key passphrases entered temporarily are not persisted or synchronized. Turning a scope off or revoking a device does not erase previously downloaded copies.

Personal AI configurations are keyed by space. Existing sessions retain their configuration space after logout/account changes. Copying unassigned local AI configuration into the active space is explicit. Existing conversations must be selected to enroll; while conversation sync is enabled, newly created conversations join the active space automatically. Copying a conversation from another space creates fresh identifiers, removes cross-space server references and restores read-only history.

Each AI conversation has a separate reference document. Messages retain identifiers and parent relationships within a version. Concurrent histories remain separate versions instead of interleaving unrelated answers. Both Web and desktop conflict panels can select a version or save retained versions as independent conversations. Imported tasks are terminal history, never resumed; imported conversations start idle with read-only permissions and no terminal scope. Active desktop AI operations defer AI-document exchanges and report the retry condition; configuration and credential documents can continue syncing. Attachments are independently transferred, content-addressed and reused (8 MiB per attachment, 32 MiB decoded total per conversation).

This development schema replaces the earlier token-pairing prototype and AI configuration/session schema directly. No legacy-table migration or compatibility reads are provided; use a fresh development database if the prototype's sync tables were already created. The application does not automatically delete existing databases.

Each encoded sync document is limited to 8 MiB, with up to 10,000 active records and 20,000 records including deletion markers. This version does not compact history or synchronize sorting/preferences. Immutable payload history is retained without automatic garbage collection. This is selective data synchronization, not a database replica or a backup replacement.

## 备份、数据迁移与数据库升级

完整实例使用原生数据库备份；JSON 仅迁移应用数据；数据库结构由 Goose 的编号迁移管理。具体命令、数据目录与根密钥恢复步骤见[备份、数据迁移与数据库升级](../../docs/backup-and-migrations.md)。
