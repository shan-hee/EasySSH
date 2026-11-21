import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { FolderTree, ListChecks, Server, ShieldCheck, Terminal } from "lucide-react"
import { automationApi, type MCPTool } from "@/lib/api/automation"
import { queryKeys } from "@/lib/query-keys"
import { PageLoading } from "@/components/page-loading"
import { cn } from "@/lib/utils"

type ToolCategoryKey = "servers" | "files" | "execution" | "tasks"
type ToolSafety = "readonly" | "write" | "execute"

const CATEGORY_ORDER: ToolCategoryKey[] = ["servers", "files", "execution", "tasks"]

const CATEGORY_META: Record<ToolCategoryKey, { icon: typeof Server; tone: string }> = {
  servers: { icon: Server, tone: "bg-sky-500/10 text-sky-600 dark:text-sky-400" },
  files: { icon: FolderTree, tone: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400" },
  execution: { icon: Terminal, tone: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  tasks: { icon: ListChecks, tone: "bg-violet-500/10 text-violet-600 dark:text-violet-400" },
}

function classifyTool(name: string): { category: ToolCategoryKey; safety: ToolSafety } {
  switch (name) {
    case "list_servers":
    case "get_server_info":
    case "get_system_info":
      return { category: "servers", safety: "readonly" }
    case "list_directory":
    case "read_file":
      return { category: "files", safety: "readonly" }
    case "write_file":
    case "create_directory":
    case "delete_file":
      return { category: "files", safety: "write" }
    case "list_scripts":
      return { category: "execution", safety: "readonly" }
    case "execute_command":
    case "execute_script":
      return { category: "execution", safety: "execute" }
    case "get_task":
      return { category: "tasks", safety: "readonly" }
    case "cancel_task":
      return { category: "tasks", safety: "execute" }
    default:
      return { category: "tasks", safety: "readonly" }
  }
}

const SAFETY_STYLES: Record<ToolSafety, string> = {
  readonly: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  write: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  execute: "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300",
}

export function MCPToolCatalog() {
  const { t } = useTranslation("automation")
  const tools = useQuery({
    queryKey: queryKeys.automation.tools,
    queryFn: automationApi.listTools,
    staleTime: Infinity,
  })

  const grouped = useMemo(() => {
    const map: Record<ToolCategoryKey, Array<{ tool: MCPTool; safety: ToolSafety }>> = {
      servers: [],
      files: [],
      execution: [],
      tasks: [],
    }
    for (const tool of tools.data ?? []) {
      const { category, safety } = classifyTool(tool.name)
      map[category].push({ tool, safety })
    }
    return CATEGORY_ORDER.filter((key) => map[key].length > 0).map((key) => ({
      key,
      items: map[key],
    }))
  }, [tools.data])

  if (tools.isPending) return <PageLoading className="min-h-0 py-8" />
  if (tools.isError) return <p role="alert" className="text-sm text-destructive">{t("toolsFailed")}</p>

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2.5 rounded-xl border bg-muted/30 px-3.5 py-2.5 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <span>{t("toolsPermissionHelp")}</span>
      </div>

      {grouped.map(({ key, items }) => {
        const meta = CATEGORY_META[key]
        const Icon = meta.icon
        return (
          <section key={key} className="space-y-3">
            <div className="flex items-center gap-2">
              <span className={cn("flex size-6 items-center justify-center rounded-md", meta.tone)}>
                <Icon className="size-3.5" />
              </span>
              <h3 className="text-sm font-semibold text-foreground">{t(`toolCategories.${key}`)}</h3>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                {items.length}
              </span>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {items.map(({ tool, safety }) => (
                <div
                  key={tool.name}
                  className="flex flex-col gap-2 rounded-xl border bg-card p-3.5 transition-colors hover:border-foreground/20"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {t(`toolNames.${tool.name}`, { defaultValue: tool.name })}
                      </p>
                      <code className="mt-0.5 inline-block rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                        {tool.name}
                      </code>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                        SAFETY_STYLES[safety],
                      )}
                    >
                      {t(`toolSafety.${safety}`)}
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {t(`toolDescriptions.${tool.name}`, { defaultValue: tool.description })}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
