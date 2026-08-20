import React, { type ReactNode } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { motionDurations, motionEase } from "@/lib/motion"

interface AnimatedListProps {
  children: ReactNode
  className?: string
  staggerDelay?: number
}

export const AnimatedList: React.FC<AnimatedListProps> = ({
  children,
  className = "",
  staggerDelay = 0.035,
}) => {
  const shouldReduceMotion = useReducedMotion()
  const childrenArray = React.Children.toArray(children)

  return (
    <div className={className}>
      <AnimatePresence initial={false}>
        {childrenArray.map((child, index) => (
          <motion.div
            key={(child as React.ReactElement).key ?? index}
            layout={shouldReduceMotion ? false : "position"}
            initial={shouldReduceMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={shouldReduceMotion ? undefined : { opacity: 0, y: -4 }}
            transition={{
              duration: motionDurations.layout,
              delay: shouldReduceMotion ? 0 : Math.min(index, 6) * staggerDelay,
              ease: motionEase,
            }}
            className="w-full"
          >
            {child}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

export default AnimatedList
