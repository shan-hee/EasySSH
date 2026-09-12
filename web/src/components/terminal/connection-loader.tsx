import { useCallback, useEffect, useRef, type CSSProperties } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import {
  Check,
  CircleX,
  Server as ServerIcon,
  SquareTerminal,
  Unplug,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { motionDurations, motionEase } from "@/lib/motion"

type LoaderState = "entering" | "loading" | "exiting"

export type ConnectionLoaderOutcome = "success" | "error" | "neutral"

interface ConnectionLoaderProps {
  serverName?: string
  message?: string
  exitMessage?: string
  state?: LoaderState
  outcome?: ConnectionLoaderOutcome
  onAnimationComplete?: () => void
}

type ConnectionLoaderStyle = CSSProperties & {
  "--connection-accent": string
}

const getOutcomeAccent = (outcome: ConnectionLoaderOutcome) => {
  switch (outcome) {
    case "success":
      return "var(--status-connected)"
    case "error":
      return "var(--status-danger)"
    default:
      return "var(--muted-foreground)"
  }
}

const getOutcomeIcon = (outcome: ConnectionLoaderOutcome) => {
  switch (outcome) {
    case "success":
      return Check
    case "error":
      return CircleX
    default:
      return Unplug
  }
}

export function ConnectionLoader({
  serverName,
  message,
  exitMessage,
  state = "loading",
  outcome = "success",
  onAnimationComplete,
}: ConnectionLoaderProps) {
  const { t } = useTranslation("terminal")
  const shouldReduceMotion = useReducedMotion()
  const exitCompletedRef = useRef(false)
  const isExiting = state === "exiting"
  const displayMessage = isExiting
    ? exitMessage ?? t("connectionLoaderSuccess")
    : message ?? t("connectionLoaderConnecting")
  const accentColor = isExiting
    ? getOutcomeAccent(outcome)
    : "var(--primary)"
  const OutcomeIcon = getOutcomeIcon(outcome)

  const completeExit = useCallback(() => {
    if (exitCompletedRef.current) return
    exitCompletedRef.current = true
    onAnimationComplete?.()
  }, [onAnimationComplete])

  useEffect(() => {
    if (!isExiting) {
      exitCompletedRef.current = false
    }
  }, [isExiting])

  const loaderStyle: ConnectionLoaderStyle = {
    "--connection-accent": accentColor,
  }

  return (
    <div
      className="relative h-full w-full overflow-hidden text-foreground"
      style={loaderStyle}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-busy={!isExiting}
      aria-label={`${displayMessage}: ${serverName ?? t("connectionLoaderServerFallback")}`}
    >
      <motion.div
        className="absolute inset-0 flex items-center justify-center bg-background px-5 py-10"
        // 首帧完整遮住终端背景，避免加载层淡入、缩放时先露出自定义图片。
        initial={false}
        animate={isExiting
          ? { opacity: 0, scale: shouldReduceMotion ? 1 : 1.01 }
          : { opacity: 1, scale: 1 }}
        transition={{
          duration: shouldReduceMotion ? 0 : motionDurations.state,
          ease: motionEase,
        }}
        onAnimationComplete={() => {
          if (isExiting) completeExit()
        }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background: "radial-gradient(circle at 50% 46%, color-mix(in oklab, var(--connection-accent) 10%, transparent), transparent 48%)",
          }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage: "linear-gradient(to right, var(--foreground) 1px, transparent 1px), linear-gradient(to bottom, var(--foreground) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
            maskImage: "radial-gradient(circle at center, black, transparent 72%)",
          }}
        />

        <div className="relative z-10 flex w-full max-w-xl flex-col items-center">
          <div className="flex h-14 w-full items-center justify-center" aria-hidden="true">
            <div className="relative flex size-12 shrink-0 items-center justify-center rounded-2xl border border-border/70 bg-card/70 text-foreground shadow-sm backdrop-blur-sm sm:size-14">
              <SquareTerminal className="size-5 sm:size-6" strokeWidth={1.7} />
              <span className="absolute -bottom-1 -right-1 size-3 rounded-full border-2 border-background bg-status-connected" />
            </div>

            <div className="relative mx-4 h-8 w-[clamp(7rem,28vw,18rem)] overflow-hidden sm:mx-6">
              <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
              <motion.div
                className="absolute left-[-34%] top-1/2 h-px w-1/3 -translate-y-1/2"
                style={{
                  background: "linear-gradient(90deg, transparent, var(--connection-accent))",
                }}
                animate={isExiting
                  ? { x: "400%", opacity: outcome === "success" ? 1 : 0.45 }
                  : shouldReduceMotion
                    ? { x: "200%", opacity: 0.7 }
                    : { x: ["0%", "400%"], opacity: [0, 1, 1, 0] }}
                transition={isExiting
                  ? { duration: shouldReduceMotion ? 0 : motionDurations.state, ease: motionEase }
                  : shouldReduceMotion
                    ? { duration: 0 }
                    : {
                        duration: 1.35,
                        ease: "linear",
                        repeat: Infinity,
                        times: [0, 0.14, 0.82, 1],
                      }}
              >
                <span
                  className="absolute right-0 top-1/2 size-1.5 -translate-y-1/2 rounded-full"
                  style={{
                    backgroundColor: "var(--connection-accent)",
                    boxShadow: "0 0 16px color-mix(in oklab, var(--connection-accent) 70%, transparent)",
                  }}
                />
              </motion.div>
            </div>

            <div className="relative flex size-12 shrink-0 items-center justify-center rounded-2xl border border-border/70 bg-card/70 text-foreground shadow-sm backdrop-blur-sm sm:size-14">
              <motion.span
                className="pointer-events-none absolute inset-0 rounded-2xl border"
                style={{ borderColor: "var(--connection-accent)" }}
                animate={isExiting
                  ? { opacity: [0.55, 0], scale: [1, 1.22] }
                  : shouldReduceMotion
                    ? { opacity: 0.3, scale: 1 }
                    : { opacity: [0.15, 0.5, 0.15], scale: [1, 1.08, 1] }}
                transition={isExiting
                  ? { duration: shouldReduceMotion ? 0 : motionDurations.layout, ease: motionEase }
                  : shouldReduceMotion
                    ? { duration: 0 }
                    : { duration: 1.8, ease: "easeInOut", repeat: Infinity }}
              />
              <AnimatePresence mode="sync" initial={false}>
                <motion.span
                  key={isExiting ? outcome : "connecting"}
                  className="absolute inset-0 flex items-center justify-center"
                  initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
                  transition={{ duration: shouldReduceMotion ? 0 : motionDurations.press, ease: motionEase }}
                  style={isExiting ? { color: "var(--connection-accent)" } : undefined}
                >
                  {isExiting
                    ? <OutcomeIcon className="size-5 sm:size-6" strokeWidth={1.8} />
                    : <ServerIcon className="size-5 sm:size-6" strokeWidth={1.7} />}
                </motion.span>
              </AnimatePresence>
            </div>
          </div>

          <div className="relative mt-8 h-12 w-full text-center">
            <AnimatePresence mode="sync" initial={false}>
              <motion.p
                key={displayMessage}
                className="absolute inset-x-0 top-0 truncate text-sm font-medium tracking-wide text-foreground"
                initial={shouldReduceMotion ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
                transition={{ duration: shouldReduceMotion ? 0 : motionDurations.press, ease: motionEase }}
              >
                {displayMessage}
              </motion.p>
            </AnimatePresence>
            <p className="absolute inset-x-0 top-7 truncate font-mono text-xs text-muted-foreground">
              {serverName ?? t("connectionLoaderServerFallback")}
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
