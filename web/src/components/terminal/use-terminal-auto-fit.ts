
import { useEffect, useEffectEvent, type RefObject } from "react"
import type { FitAddon } from "@xterm/addon-fit"
import type { Terminal } from "@xterm/xterm"

export interface UseTerminalAutoFitOptions {
  terminal: Terminal | null | undefined
  fitAddon: FitAddon | null | undefined
  containerRef: RefObject<HTMLDivElement | null>
  isActive: boolean
  terminalReady: boolean
  onTerminalResize: (cols: number, rows: number) => void
  onResize?: (cols: number, rows: number) => void
  debounceMs?: number
}

export function useTerminalAutoFit({
  terminal,
  fitAddon,
  containerRef,
  isActive,
  terminalReady,
  onTerminalResize,
  onResize,
  debounceMs = 80,
}: UseTerminalAutoFitOptions) {
  const notifyResize = useEffectEvent((cols: number, rows: number) => {
    onTerminalResize(cols, rows)
    onResize?.(cols, rows)
  })
  useEffect(() => {
    if (!isActive || !terminal || !fitAddon || !containerRef.current || !terminalReady) return

    let resizeTimeout: ReturnType<typeof setTimeout> | null = null
    let resizeObserver: ResizeObserver | null = null
    let removeWindowResize: (() => void) | null = null
    let fitFrame: number | null = null
    const workspace = containerRef.current.closest('[data-terminal-layout]')
    let lastNotified: { cols: number; rows: number } | null = null
    const syncSize = () => {
      if (lastNotified?.cols === terminal.cols && lastNotified.rows === terminal.rows) return
      lastNotified = { cols: terminal.cols, rows: terminal.rows }
      notifyResize(terminal.cols, terminal.rows)
    }
    // 字体设置和分屏等路径也可能改变字符格，统一从 xterm 的尺寸事件同步。
    const resizeSubscription = terminal.onResize(syncSize)

    const applyFit = () => {
      const containerElement = containerRef.current
      if (
        !isActive ||
        !fitAddon ||
        !terminal ||
        !containerElement ||
        containerElement.clientWidth <= 0 ||
        containerElement.clientHeight <= 0
      ) {
        return
      }

      const animating = Array.from(workspace?.querySelectorAll('[data-terminal-panel]') ?? [])
        .some(panel => panel.getAnimations().some(animation => (
          animation instanceof CSSTransition &&
          ['width', 'max-width'].includes(animation.transitionProperty) &&
          animation.playState === 'running'
        )))
      if (animating) {
        scheduleFit()
        return
      }
      fitAddon.fit()
      // xterm.resize 自带重绘；像素变化未跨越字符格时不发送重复 PTY resize。
      syncSize()
    }

    const scheduleFit = (delay = debounceMs) => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout)
      }
      resizeTimeout = setTimeout(() => {
        resizeTimeout = null
        if (fitFrame !== null) cancelAnimationFrame(fitFrame)
        fitFrame = requestAnimationFrame(() => {
          fitFrame = null
          applyFit()
        })
      }, delay)
    }

    const handleTransition = (event: Event) => {
      const transition = event as TransitionEvent
      const target = transition.target
      if (!(target instanceof HTMLElement) || !target.hasAttribute('data-terminal-panel')) return
      if (!['width', 'max-width'].includes(transition.propertyName)) return
      scheduleFit(0)
    }
    for (const type of ['transitionend', 'transitioncancel']) {
      workspace?.addEventListener(type, handleTransition)
    }

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        scheduleFit()
      })
      const containerElement = containerRef.current
      if (containerElement) {
        resizeObserver.observe(containerElement)
      }
    } else {
      const handleResize = () => scheduleFit()
      window.addEventListener("resize", handleResize)
      removeWindowResize = () => window.removeEventListener("resize", handleResize)
    }

    scheduleFit()

    return () => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout)
      }
      if (fitFrame !== null) cancelAnimationFrame(fitFrame)
      resizeSubscription.dispose()
      for (const type of ['transitionend', 'transitioncancel']) {
        workspace?.removeEventListener(type, handleTransition)
      }
      resizeObserver?.disconnect()
      resizeObserver = null
      removeWindowResize?.()
      removeWindowResize = null
    }
  }, [containerRef, debounceMs, fitAddon, isActive, terminal, terminalReady])
}
