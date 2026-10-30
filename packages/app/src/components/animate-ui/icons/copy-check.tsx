import { motion, useReducedMotion, type SVGMotionProps } from "motion/react"

import { motionTransitions } from "@/lib/motion"

type CopyCheckIconProps = Omit<
  SVGMotionProps<SVGSVGElement>,
  "animate" | "children"
> & {
  copied: boolean
  size?: number | string
}

/**
 * A compact state-driven icon adapted from Animate UI's animated icon pattern.
 * It animates only SVG paths and never changes its parent button geometry.
 */
function CopyCheckIcon({
  copied,
  size = 16,
  ...props
}: CopyCheckIconProps) {
  const reduceMotion = useReducedMotion()
  const transition = reduceMotion ? { duration: 0 } : motionTransitions.state

  return (
    <motion.svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <motion.g
        initial={false}
        animate={{ opacity: copied ? 0 : 1, scale: copied ? 0.82 : 1 }}
        transition={transition}
        style={{ transformOrigin: "center" }}
      >
        <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
      </motion.g>
      <motion.path
        d="m4 12 5 5L20 6"
        initial={false}
        animate={{
          opacity: copied ? 1 : 0,
          pathLength: copied ? 1 : 0,
          scale: copied ? 1 : 0.82,
        }}
        transition={transition}
        style={{ transformOrigin: "center" }}
      />
    </motion.svg>
  )
}

export { CopyCheckIcon, type CopyCheckIconProps }
