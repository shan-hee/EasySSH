import { useEffect, useRef } from "react"

/** Brief pointer passes should not download every menu destination. */
export function useIntentPreload(preload: (intent: "hover" | "navigation") => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current) }, [])
  return {
    onPointerEnter: () => {
      cancel()
      timer.current = setTimeout(() => { timer.current = null; preload("hover") }, 120)
    },
    onPointerLeave: cancel,
    onFocus: () => { cancel(); preload("hover") },
    onBlur: cancel,
    onPointerDown: () => { cancel(); preload("navigation") },
    onClick: () => { cancel(); preload("navigation") },
  }
}
