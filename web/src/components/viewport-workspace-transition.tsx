import type { PropsWithChildren } from "react"

import { FadeIn } from "@/components/motion/fade-in"
import { motionTransitions } from "@/lib/motion"

export function ViewportWorkspaceTransition({ children }: PropsWithChildren) {
  return (
    <FadeIn
      transition={motionTransitions.fade}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      {children}
    </FadeIn>
  )
}
