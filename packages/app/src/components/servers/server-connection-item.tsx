import type { ReactNode } from "react"
import { Server as ServerIcon } from "lucide-react"
import type { Server } from "@/lib/server-types"
import { cn } from "@/lib/utils"

export const SERVER_GRID_CLASSNAME = "grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-2.5"

export function getServerItemClassName(viewMode: "grid" | "list", sortable = true) {
  return cn(
    "server-connection-item relative rounded-lg border border-border bg-card text-card-foreground outline-none transition-[background-color,border-color,box-shadow] duration-200 focus-visible:border-primary/50 focus-visible:ring-[3px] focus-visible:ring-primary/20",
    sortable && "cursor-grab active:cursor-grabbing",
    viewMode === "grid"
      ? "grid min-h-[72px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 p-3 hover:bg-accent/60 hover:border-primary/40"
      : "grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 p-4 hover:bg-accent/60 hover:border-primary/40 sm:flex sm:items-center",
  )
}

/** 展示连接身份，不依赖账户、凭据或服务器管理接口。 */
export function ServerConnectionSummary({
  server,
  icon = <ServerIcon className="size-5 text-muted-foreground" />,
}: {
  server: Pick<Server, "name" | "host" | "port" | "username"> & Partial<Pick<Server, "status">>
  icon?: ReactNode
}) {
  return (
    <>
      {icon}
      <div className="min-w-0 space-y-1">
        <h3
          className={cn("truncate text-sm font-medium", server.status === "offline" ? "text-muted-foreground" : "text-card-foreground")}
          title={server.name || server.host}
        >
          {server.name || server.host}
        </h3>
        <p
          className="truncate font-mono text-xs text-muted-foreground"
          title={`${server.username}@${server.host}:${server.port}`}
        >
          {server.username}@{server.host}:{server.port}
        </p>
      </div>
    </>
  )
}
