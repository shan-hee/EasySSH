import * as React from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"
import { motionTransitions } from "@/lib/motion"

type AnimatedStateTextProps = React.ComponentProps<"span"> & {
  value: React.Key
}

function AnimatedStateText({
  value,
  children,
  className,
  ...props
}: AnimatedStateTextProps) {
  const reduceMotion = useReducedMotion()

  if (reduceMotion) {
    return (
      <span aria-live="polite" className={className} {...props}>
        {children}
      </span>
    )
  }

  return (
    <span
      aria-live="polite"
      className={cn("inline-grid items-center", className)}
      {...props}
    >
      <AnimatePresence initial={false} mode="sync">
        <motion.span
          key={value}
          className="[grid-area:1/1]"
          initial={{ opacity: 0, y: 2 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{
            opacity: 0,
            y: -1,
            transition: motionTransitions.exit,
          }}
          transition={motionTransitions.state}
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

export { AnimatedStateText, type AnimatedStateTextProps }
