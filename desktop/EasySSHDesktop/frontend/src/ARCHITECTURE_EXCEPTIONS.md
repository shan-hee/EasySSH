# Desktop Frontend Architecture Exceptions

This file tracks temporary Desktop frontend dependencies that are allowed while the Web/Desktop Workspace boundary is being tightened. Each entry should have an exit condition before it grows into a default pattern.

## Active Exceptions

| Exception | Current Use | Why It Exists | Exit Condition |
| --- | --- | --- | --- |
| Web Dashboard AI page reuse | `shell/desktop-ai-assistant-view.tsx` wraps `@/pages/dashboard/ai-assistant-page` | Desktop AI shipped by adapting the existing Web page before a shared AI workspace view exists | Extract a shell-neutral AI workspace view with Web/Desktop adapters |
| Web Dashboard header action reuse | `shell/desktop-titlebar.tsx` imports `@/components/dashboard-header-actions` directly | Desktop still needs the existing theme/header action controls | Replace with a Desktop-specific shell action component or move the reusable part into a shell-neutral component |
| Browser-backed preferences | `App.tsx` uses `createBrowserWorkspacePreferenceAdapter` with a Desktop key prefix | Wails WebView supports browser storage and keeps behavior compatible during the first split | Replace with a Desktop preference adapter backed by Wails/local runtime storage when available |

## Rules

- Do not add new Web Dashboard imports to `@easyssh/ssh-workspace/desktop`.
- New exceptions must explain why an adapter contract is not enough yet.
- When touching an exception, either reduce its scope or update the exit condition.
