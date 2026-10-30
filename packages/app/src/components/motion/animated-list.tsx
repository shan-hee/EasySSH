import React, { useRef, type ReactNode } from "react"
import { motion, useInView, useReducedMotion } from "motion/react"

interface AnimatedItemProps {
  children: ReactNode
  delay?: number
  index: number
}

const AnimatedItem: React.FC<AnimatedItemProps> = ({ children, delay = 0, index }) => {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { amount: 0.5, once: true })
  const reducedMotion = useReducedMotion()

  return (
    <motion.div
      ref={ref}
      data-index={index}
      initial={reducedMotion ? false : { scale: 0.95, opacity: 0, y: 10 }}
      animate={inView || reducedMotion
        ? { scale: 1, opacity: 1, y: 0 }
        : { scale: 0.95, opacity: 0, y: 10 }}
      transition={{ duration: reducedMotion ? 0 : 0.3, delay: reducedMotion ? 0 : delay, ease: "easeOut" }}
      className="w-full"
    >
      {children}
    </motion.div>
  )
}

interface AnimatedListProps {
  children: ReactNode
  className?: string
  staggerDelay?: number
  maxStaggerDelay?: number
}

export const AnimatedList: React.FC<AnimatedListProps> = ({
  children,
  className = "",
  staggerDelay = 0.05,
  maxStaggerDelay = Infinity,
}) => {
  const childrenArray = React.Children.toArray(children)

  return (
    <div className={className}>
      {childrenArray.map((child, index) => (
        <AnimatedItem
          key={(child as React.ReactElement).key || index}
          index={index}
          delay={Math.min(index * staggerDelay, maxStaggerDelay)}
        >
          {child}
        </AnimatedItem>
      ))}
    </div>
  )
}

export default AnimatedList
