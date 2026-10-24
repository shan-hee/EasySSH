import type { ReactNode } from "react"
import { motion, useReducedMotion } from "motion/react"

export default function AuthTransition({ children }: { children: ReactNode }) {
  const reducedMotion = useReducedMotion()
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reducedMotion ? 0 : 0.15 }}>
      {children}
    </motion.div>
  )
}
