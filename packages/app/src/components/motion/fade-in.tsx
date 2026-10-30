import {
  motion,
  useReducedMotion,
  type HTMLMotionProps,
  type Transition,
} from "motion/react"

import { motionTransitions } from "@/lib/motion"

type FadeInProps = Omit<HTMLMotionProps<"div">, "initial" | "animate"> & {
  delay?: number
  offsetY?: number
  transition?: Transition
}

function FadeIn({
  delay = 0,
  offsetY = 0,
  transition = motionTransitions.reveal,
  ...props
}: FadeInProps) {
  const reduceMotion = useReducedMotion()

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: offsetY }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        reduceMotion
          ? { duration: 0 }
          : {
              ...transition,
              delay: (transition.delay ?? 0) + delay / 1000,
            }
      }
      {...props}
    />
  )
}

export { FadeIn, type FadeInProps }
