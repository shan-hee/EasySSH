import { useEffect, useMemo, useState } from "react"
import {
  Activity,
  ArrowUpRight,
  Clock3,
  FolderOpen,
  Radio,
  Server,
  TerminalSquare,
} from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { motion, useReducedMotion } from "motion/react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"

import { useClientAuth } from "@/components/client-auth-provider"
import { PageHeader } from "@/components/page-header"
import { useAuthReady } from "@/hooks/use-auth-ready"
import type { OverviewRecentServer } from "@/lib/api/dashboard"
import { dashboardOverviewQueryOptions } from "@/lib/dashboard-query-options"

import { DashboardGlobe } from "./components/dashboard-globe"
import "./overview-page.css"

const AUTO_REFRESH_INTERVAL = 5 * 60 * 1000

type GreetingKey =
  | "greetingMorning"
  | "greetingAfternoon"
  | "greetingEvening"
  | "greetingNight"

function getGreetingKey(hour: number): GreetingKey {
  if (hour >= 5 && hour < 12) return "greetingMorning"
  if (hour >= 12 && hour < 18) return "greetingAfternoon"
  if (hour >= 18 && hour < 23) return "greetingEvening"
  return "greetingNight"
}

function useCurrentTime() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  return now
}

function LocalTime({ now }: { now: Date }) {
  const { i18n } = useTranslation()

  const display = useMemo(
    () => new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(now),
    [i18n.language, i18n.resolvedLanguage, now],
  )

  return <time dateTime={now.toISOString()}>{display}</time>
}

function getServerDisplayName(server: OverviewRecentServer) {
  return server.name || `${server.username}@${server.host}`
}

function getServerLocation(server: OverviewRecentServer) {
  const location = [server.city, server.country].filter(Boolean).join(", ")
  return location || server.group || `${server.host}:${server.port}`
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const { user } = useClientAuth()
  const { ready } = useAuthReady()
  const { t } = useTranslation("dashboard")
  const reduceMotion = useReducedMotion()
  const now = useCurrentTime()
  const greetingKey = getGreetingKey(now.getHours())
  const username = user?.username ?? "EasySSH"

  const overviewQuery = useQuery({
    ...dashboardOverviewQueryOptions(),
    enabled: ready,
    refetchInterval: AUTO_REFRESH_INTERVAL,
  })
  const overview = overviewQuery.data
  const recentServers = overview?.recent_servers ?? []
  const dataUnavailable = overviewQuery.isError
  const dataLoading = overviewQuery.isPending

  const reveal = reduceMotion
    ? undefined
    : {
        initial: { opacity: 0, y: 18 },
        animate: { opacity: 1, y: 0 },
      }

  return (
    <>
      <PageHeader title={t("title")} />

      <main className="dashboard-overview-shell flex min-h-0 flex-1 px-3 pb-3 sm:px-4 sm:pb-4">
        <section className="dashboard-orbit relative w-full overflow-hidden rounded-[1.35rem] lg:rounded-[1.75rem]">
          <div className="dashboard-orbit-grid" aria-hidden="true" />
          <div className="dashboard-orbit-vignette" aria-hidden="true" />

          <motion.div
            {...reveal}
            transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-20 flex items-center justify-between gap-4 px-5 pt-5 sm:px-7 sm:pt-7 lg:px-10 lg:pt-8"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-[-0.015em] text-foreground sm:text-base">
                {t(greetingKey)}, {username} <span aria-hidden="true">👋</span>
              </p>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {t("subtitle")}
              </p>
            </div>

            <div className="flex items-center gap-3 text-[0.68rem] font-medium tracking-[0.14em] text-muted-foreground sm:gap-5">
              <span className="hidden items-center gap-2 sm:flex">
                <Clock3 className="size-3.5" />
                <LocalTime now={now} />
              </span>
              <span className="h-4 w-px bg-border" aria-hidden="true" />
              <span
                className={
                  dataUnavailable
                    ? "flex items-center gap-2 text-status-danger"
                    : dataLoading
                      ? "flex items-center gap-2 text-status-warning"
                      : "flex items-center gap-2 text-status-connected"
                }
              >
                <span
                  className={
                    dataUnavailable
                      ? "dashboard-live-dot is-error"
                      : dataLoading
                        ? "dashboard-live-dot is-loading"
                        : "dashboard-live-dot"
                  }
                  aria-hidden="true"
                />
                {dataUnavailable
                  ? t("orbitDataUnavailable")
                  : dataLoading
                    ? t("orbitDataLoading")
                    : t("orbitDataLive")}
              </span>
            </div>
          </motion.div>

          <div className="dashboard-hero-copy relative z-20 px-5 sm:px-7 lg:px-10">
            <motion.div
              {...reveal}
              transition={{ duration: 0.75, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-card/55 px-3 py-1.5 text-[0.65rem] font-medium tracking-[0.16em] text-muted-foreground backdrop-blur-md">
                <Radio className="size-3.5 text-primary" />
                {t("orbitWorkspace")}
              </div>

              <h2 className="dashboard-orbit-headline font-medium text-foreground">
                {t("orbitHeadline")}
              </h2>
              <p className="dashboard-orbit-description mt-6 text-sm leading-7 text-muted-foreground sm:text-base sm:leading-8">
                {t("orbitDescription")}
              </p>

              <div className="dashboard-orbit-actions mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={() => navigate("/dashboard/terminal")}
                  className="dashboard-primary-action group inline-flex h-12 items-center justify-center gap-3 rounded-full px-5 text-sm font-semibold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <TerminalSquare className="size-4" />
                  {t("orbitNewSession")}
                  <ArrowUpRight className="size-4 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </button>
                <button
                  type="button"
                  onClick={() => navigate("/dashboard/terminal?sftpPicker=1")}
                  className="inline-flex h-12 items-center justify-center gap-3 rounded-full border border-border bg-card/45 px-5 text-sm font-medium text-foreground/76 backdrop-blur-md transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <FolderOpen className="size-4" />
                  {t("orbitOpenFiles")}
                </button>
              </div>
            </motion.div>
          </div>

          <motion.div
            initial={reduceMotion ? undefined : { opacity: 0, scale: 0.94 }}
            animate={reduceMotion ? undefined : { opacity: 1, scale: 1 }}
            transition={{ duration: 1.1, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className="dashboard-globe-stage"
          >
            <div className="dashboard-globe-aura" aria-hidden="true" />
            <DashboardGlobe distribution={overview?.distribution ?? []} />
          </motion.div>

          <motion.div
            {...reveal}
            transition={{ duration: 0.7, delay: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="dashboard-node-panel"
          >
            <div className="flex items-end justify-between gap-4 border-b border-border pb-4">
              <div>
                <p className="text-[0.62rem] font-semibold tracking-[0.2em] text-muted-foreground">
                  {t("orbitRecentNodes")}
                </p>
                <p className="mt-1.5 text-sm text-foreground/70">
                  {overviewQuery.isPending
                    ? t("orbitDataLoading")
                    : recentServers.length > 0
                      ? t("orbitRecentHint")
                      : t("noServers")}
                </p>
              </div>
            </div>

            <div className="mt-2 divide-y divide-border">
              {overviewQuery.isPending ? (
                Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className="h-14 animate-pulse bg-muted/35" />
                ))
              ) : recentServers.map((server, index) => (
                <button
                  key={server.id}
                  type="button"
                  onClick={() => navigate(
                    `/dashboard/terminal?serverId=${encodeURIComponent(server.id)}`,
                  )}
                  className="group flex w-full items-center gap-3 py-3 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted/55 text-[0.62rem] font-semibold text-muted-foreground transition-colors group-hover:border-primary/30 group-hover:text-primary">
                    0{index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-foreground/78">
                      {getServerDisplayName(server)}
                    </span>
                    <span className="mt-0.5 block truncate text-[0.64rem] tracking-[0.08em] text-muted-foreground/70">
                      {getServerLocation(server)}
                    </span>
                  </span>
                  <span
                    className={
                      server.status === "online"
                        ? "text-[0.66rem] text-status-connected"
                        : "text-[0.66rem] text-muted-foreground"
                    }
                  >
                    {t(server.status === "online" ? "statusOnline" : "statusOffline")}
                  </span>
                  <ArrowUpRight className="size-3.5 text-muted-foreground/50 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground/70" />
                </button>
              ))}
            </div>
          </motion.div>

          <motion.div
            {...reveal}
            transition={{ duration: 0.7, delay: 0.36, ease: [0.22, 1, 0.36, 1] }}
            className="dashboard-metrics"
          >
            <div className="dashboard-metric">
              <Server className="size-4 text-muted-foreground" />
              <div>
                <p className="text-[0.61rem] tracking-[0.14em] text-muted-foreground">{t("orbitNodes")}</p>
                <p className="mt-1 text-lg font-medium tracking-[-0.03em] text-foreground/78">
                  {overview
                    ? `${overview.stats.online_servers} / ${overview.stats.total_servers}`
                    : "—"}
                </p>
              </div>
            </div>
            <div className="dashboard-metric">
              <TerminalSquare className="size-4 text-muted-foreground" />
              <div>
                <p className="text-[0.61rem] tracking-[0.14em] text-muted-foreground">{t("orbitSessions")}</p>
                <p className="mt-1 text-lg font-medium tracking-[-0.03em] text-foreground/78">
                  {overview ? overview.stats.active_sessions : "—"}
                </p>
              </div>
            </div>
            <div className="dashboard-metric">
              <Activity className="size-4 text-muted-foreground" />
              <div>
                <p className="text-[0.61rem] tracking-[0.14em] text-muted-foreground">
                  {t("orbitTodayCommands")}
                </p>
                <p className="mt-1 text-lg font-medium tracking-[-0.03em] text-foreground/78">
                  {overview ? overview.stats.today_commands : "—"}
                </p>
              </div>
            </div>
          </motion.div>
        </section>
      </main>
    </>
  )
}
