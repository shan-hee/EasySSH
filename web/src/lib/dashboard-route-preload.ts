const workspaceLoaders: Record<string, () => Promise<unknown>> = {
  "/dashboard/terminal": () => import("@/pages/dashboard/terminal-page"),
  "/dashboard/ai-assistant": () => import("@/pages/dashboard/ai-assistant-page"),
}

export function preloadDashboardWorkspace(url: string) {
  const pathname = url.split("?", 1)[0]
  const load = workspaceLoaders[pathname]
  if (load) {
    void load().catch(() => undefined)
  }
}
