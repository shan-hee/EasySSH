import { ArrowUpRight, Server, X } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"

import { FadeIn } from "@/components/motion/fade-in"
import type { OverviewRegionCount } from "@/lib/api/dashboard"

export function DashboardRegionPanel({
  region,
  onClose,
}: {
  region: OverviewRegionCount
  onClose: () => void
}) {
  const { t } = useTranslation("dashboard")

  return (
    <FadeIn
      key={region.country_code}
      offsetY={8}
      id="dashboard-region-servers"
      role="region"
      aria-labelledby="dashboard-region-title"
      className="dashboard-region-panel"
    >
      <div className="flex items-start justify-between gap-3 border-b border-border pb-4">
        <div className="min-w-0" aria-live="polite">
          <p className="text-[0.62rem] font-semibold tracking-[0.16em] text-muted-foreground">
            {t("orbitRegionServers")}
          </p>
          <h3 id="dashboard-region-title" className="mt-1.5 truncate text-base font-semibold text-foreground">
            {region.region}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("mapServerCount", { count: region.count })}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("orbitCloseRegionServers")}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <X className="size-4" />
        </button>
      </div>

      <ul className="dashboard-region-server-list mt-2 divide-y divide-border">
        {region.servers.map((server) => {
          const host = server.host.includes(":") ? `[${server.host}]` : server.host
          const name = server.name || `${server.username}@${host}`

          return (
            <li key={server.id}>
              <Link
                to={`/dashboard/terminal?serverId=${encodeURIComponent(server.id)}`}
                aria-label={t("orbitConnectServer", { name })}
                className="group flex w-full items-center gap-3 rounded-md py-3 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted/55 text-muted-foreground transition-colors group-hover:border-primary/30 group-hover:text-primary">
                  <Server className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-foreground/80" title={name}>
                    {name}
                  </span>
                  <span className="mt-0.5 block truncate text-[0.64rem] text-muted-foreground" title={`${host}:${server.port}`}>
                    {host}:{server.port}
                  </span>
                </span>
                <span className={server.status === "online" ? "shrink-0 text-[0.66rem] text-status-connected" : "shrink-0 text-[0.66rem] text-muted-foreground"}>
                  {t(server.status === "online" ? "statusOnline" : "statusOffline")}
                </span>
                <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground/80" />
              </Link>
            </li>
          )
        })}
      </ul>
    </FadeIn>
  )
}
