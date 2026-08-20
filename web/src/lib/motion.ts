import type { Transition } from "motion/react"

export const motionDurations = {
  press: 0.12,
  state: 0.16,
  page: 0.16,
  layout: 0.26,
} as const

export const motionEase = [0.22, 1, 0.36, 1] as const

export const pageTransition: Transition = {
  duration: motionDurations.page,
  ease: motionEase,
}
