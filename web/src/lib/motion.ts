import type { SpringOptions, Transition } from "motion/react"

export const motionDurations = {
  exit: 0.12,
  press: 0.12,
  state: 0.16,
  page: 0.16,
  content: 0.18,
  layout: 0.26,
} as const

export const motionEase = [0.22, 1, 0.36, 1] as const
export const motionExitEase = [0.4, 0, 1, 1] as const

export const motionTransitions = {
  fade: {
    duration: motionDurations.page,
    ease: motionEase,
  },
  reveal: {
    duration: motionDurations.content,
    ease: motionEase,
  },
  state: {
    duration: motionDurations.state,
    ease: motionEase,
  },
  exit: {
    duration: motionDurations.exit,
    ease: motionExitEase,
  },
} satisfies Record<string, Transition>

export const numberSpring: SpringOptions = {
  stiffness: 90,
  damping: 50,
  mass: 1,
}
