import * as React from "react"
import {
  useMotionValue,
  useReducedMotion,
  useSpring,
  type SpringOptions,
} from "motion/react"

import { numberSpring } from "@/lib/motion"

type CountingNumberProps = Omit<
  React.ComponentPropsWithoutRef<"span">,
  "children"
> & {
  number: number
  fromNumber?: number
  delay?: number
  format?: (value: number) => string
  initiallyStable?: boolean
  transition?: SpringOptions
}

const defaultFormat = (value: number) => Math.round(value).toString()

/**
 * Adapted from Animate UI's Counting Number registry primitive:
 * https://animate-ui.com/docs/primitives/texts/counting-number
 * It stays outside components/ui so Motion never becomes a Radix dependency.
 */
const CountingNumber = React.forwardRef<HTMLSpanElement, CountingNumberProps>(
  (
    {
      number,
      fromNumber = 0,
      delay = 0,
      format = defaultFormat,
      initiallyStable = false,
      transition = numberSpring,
      ...props
    },
    forwardedRef,
  ) => {
    const localRef = React.useRef<HTMLSpanElement>(null)
    const reduceMotion = useReducedMotion()
    const initialValue = initiallyStable || reduceMotion ? number : fromNumber
    const motionValue = useMotionValue(initialValue)
    const springValue = useSpring(motionValue, transition)

    React.useImperativeHandle(
      forwardedRef,
      () => localRef.current as HTMLSpanElement,
    )

    React.useEffect(() => {
      if (localRef.current) {
        localRef.current.textContent = format(springValue.get())
      }

      const unsubscribe = springValue.on("change", (latest) => {
        if (localRef.current) {
          localRef.current.textContent = format(latest)
        }
      })

      return unsubscribe
    }, [format, springValue])

    React.useEffect(() => {
      if (reduceMotion) {
        springValue.jump(number)
        return
      }

      const timeoutId = window.setTimeout(() => motionValue.set(number), delay)
      return () => window.clearTimeout(timeoutId)
    }, [delay, motionValue, number, reduceMotion, springValue])

    return (
      <span
        ref={localRef}
        data-slot="counting-number"
        aria-label={format(number)}
        {...props}
      >
        {format(initialValue)}
      </span>
    )
  },
)
CountingNumber.displayName = "CountingNumber"

export { CountingNumber, type CountingNumberProps }
