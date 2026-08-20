import type { PropsWithChildren } from "react"
import { motion } from "motion/react"

import { pageTransition } from "@/lib/motion"

export function ViewportWorkspaceTransition({ children }: PropsWithChildren) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={pageTransition}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      {children}
    </motion.div>
  )
}
