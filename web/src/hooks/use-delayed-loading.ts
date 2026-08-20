import { useEffect, useState } from "react"

export function useDelayedLoading(active: boolean, delay = 160) {
  const [visible, setVisible] = useState(active && delay <= 0)

  useEffect(() => {
    if (!active) {
      setVisible(false)
      return
    }

    if (delay <= 0) {
      setVisible(true)
      return
    }

    const timer = window.setTimeout(() => setVisible(true), delay)
    return () => window.clearTimeout(timer)
  }, [active, delay])

  return visible
}
