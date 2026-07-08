# EasySSH Desktop

EasySSH Desktop is the Wails v3 shell for the embeddable SSH/SFTP workspace. The desktop home screen keeps the web terminal workspace shape, while moving dashboard navigation and administration concerns out of the first window.

## Scope

- Wails v3 desktop shell with a compact SSH/SFTP workspace first screen.
- Runtime bridge for platform, version, capability, and data directory information.
- Icon entry points for desktop-only controls such as theme and workspace settings.
- Production metadata for Windows, macOS, and Linux build assets.

## Product Boundary

Desktop shares the core EasySSH workspace capabilities with Web: SSH terminal, SFTP, file transfers, scripts, monitoring, Docker helpers, AI assistant, activity logs, and local backup/restore.

Desktop is a single-user local app. It should use `local_owner` / `owner` runtime semantics and local data-owner markers when Web-shaped data requires a `user_id`, but it must not introduce the Web user-management system. Keep these Web-only concerns out of Desktop unless a future product decision explicitly changes the boundary:

- Login/session management, registration, OAuth, 2FA, account lockout, and notification preferences.
- User, role, permission, audit, login-log, security-policy, rate-limit, and IP-allowlist administration.
- Server-side organization settings, multi-user governance, scheduled automation pages, and backend-only background task controls.

When Desktop reuses Web components, prefer adapter props such as `desktopMode` and runtime capabilities to keep the visible UI local and personal. Web-compatible backup fields such as the synthetic `users` table are compatibility shims, not a Desktop user model.

## Build

From this directory:

```bash
/root/go/bin/wails3 task windows:build ARCH=amd64
```

The Windows amd64 executable is written to `bin/EasySSH.exe`. The GitHub Release asset is `EasySSH-windows-amd64-desktop.zip`.

The release zip contains a single top-level `EasySSH.exe`. The same asset is used for manual downloads and desktop one-click updates.

Desktop data is stored in the `data` folder next to the desktop executable. The app creates that folder on startup when it does not exist.

## Layout

- `main.go`: Wails application entry point and main window configuration.
- `desktopservice.go`: Desktop runtime bridge exposed to the frontend.
- `frontend/`: React/Vite workspace shell UI.
- `build/`: Wails platform build assets and packaging metadata.
