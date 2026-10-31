import { createContext, useState } from "react"
import { useReducedMotion, type HTMLMotionProps } from "motion/react"

import { motionTransitions } from "@/lib/motion"

export const ModalOpenContext = createContext(false)

/** Keep Radix and Motion on the same state, including trigger-driven dialogs. */
export function useModalOpenState({ open, defaultOpen = false, onOpenChange }: {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  return {
    open: open ?? internalOpen,
    onOpenChange: (next: boolean) => {
      if (open === undefined) setInternalOpen(next)
      onOpenChange?.(next)
    },
  }
}

export function useModalMotion(kind: "dialog" | "overlay" | "top" | "right" | "bottom" | "left" = "dialog"): HTMLMotionProps<"div"> {
  const reducedMotion = useReducedMotion()
  // Translation leaves the size observer's measurements unchanged.
  const offset = reducedMotion || kind === "overlay" ? {} : kind === "dialog" ? { y: 8 }
    : kind === "left" ? { x: "-100%" } : kind === "right" ? { x: "100%" }
      : kind === "top" ? { y: "-100%" } : { y: "100%" }
  return {
    initial: { opacity: 0, ...offset },
    animate: { opacity: 1, x: 0, y: 0 },
    exit: { opacity: 0, ...offset, transition: reducedMotion ? { duration: 0 } : motionTransitions.exit },
    transition: reducedMotion ? { duration: 0 } : motionTransitions.reveal,
  }
}
