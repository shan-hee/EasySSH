import i18n from "i18next"
import { createPreloadableComponent } from "./preloadable-component"

export const { Component: PreloadedTabTerminalContent, preload: loadTabTerminalContent } = createPreloadableComponent(async () => {
  const [module] = await Promise.all([
    import("@/components/terminal/tab-terminal-content"),
    i18n.loadNamespaces(["common", "terminal", "terminalSettings", "servers", "sftp"]),
  ])
  return { default: module.TabTerminalContent }
})

export const { Component: PreloadedTerminalSftpTabContent, preload: loadTerminalSftpTabContent } = createPreloadableComponent(async () => {
  const [module] = await Promise.all([
    import("@/components/terminal/terminal-sftp-tab-content"),
    i18n.loadNamespaces(["common", "terminal", "servers", "sftp"]),
  ])
  return { default: module.TerminalSftpTabContent }
})

export function loadTerminalRuntime() {
  return Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-fit"),
    import("@xterm/addon-web-links"),
    import("@xterm/xterm/css/xterm.css"),
  ])
}

export function loadTerminalWebgl() {
  return import("@xterm/addon-webgl")
}

export async function preloadTerminalConnection() {
  // 页签模块包含连接动画；xterm 在 Hook 内动态加载，需要单独并行预加载。
  // 这里只加载模块，不创建终端实例、申请连接票据或建立 WebSocket。
  await Promise.all([
    loadTabTerminalContent(),
    loadTerminalRuntime(),
    loadTerminalWebgl(),
  ])
}
