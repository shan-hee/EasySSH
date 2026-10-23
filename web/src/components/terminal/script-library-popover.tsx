import { useMemo, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { FileCode2, Loader2, Play, RefreshCw, Search, TextCursorInput, X } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useOptionalSshWorkspace } from "@/components/ssh-workspace/ssh-workspace"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { toast } from "@/components/ui/sonner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { scriptsApi } from "@/lib/api/scripts"
import { queryKeys } from "@/lib/query-keys"
import type { Script } from "@/lib/script-types"
import { cn } from "@/lib/utils"

interface ScriptLibraryPopoverProps {
  canExecute: boolean
  sessionLabel: string
  onApplyScript: (content: string, execute: boolean) => boolean
  onFocusTerminal: () => void
}

export function ScriptLibraryPopover({
  canExecute,
  sessionLabel,
  onApplyScript,
  onFocusTerminal,
}: ScriptLibraryPopoverProps) {
  const { t } = useTranslation("terminal")
  const workspace = useOptionalSshWorkspace()
  const workspaceScripts = workspace?.adapters.apiClient?.scripts
  if (workspace?.layout === "desktop" && !workspaceScripts) {
    throw new Error("Desktop script library requires a desktop scripts api adapter")
  }
  const client = workspaceScripts ?? scriptsApi
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const restoreTerminalFocus = useRef(false)
  const scriptsQuery = useQuery({
    queryKey: [...queryKeys.scripts.all, "terminal-library", workspace?.layout ?? "web"],
    queryFn: async () => {
      const scripts: Script[] = []
      // 脚本库接口有分页，完整读取后才能按内容、标签搜索全部脚本。
      let page = 1
      let totalPages = 1
      do {
        const result = await client.list({ page, limit: 100 })
        scripts.push(...result.data.map((script) => ({ ...script, tags: script.tags ?? [] })))
        totalPages = result.total_pages
        page++
      } while (page <= totalPages)
      return scripts
    },
    enabled: open,
    staleTime: 0,
  })
  const scripts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    return (scriptsQuery.data ?? []).filter((script) => (
      !query || [script.name, script.description, script.content, ...script.tags]
        .some((value) => value.toLocaleLowerCase().includes(query))
    ))
  }, [scriptsQuery.data, search])
  const selected = scripts.find((script) => script.id === selectedId) ?? scripts[0]

  const refreshScripts = async () => {
    const result = await scriptsQuery.refetch()
    if (result.isError) {
      toast.error(t("scriptLibraryLoadFailed"))
    } else {
      toast.success(t("scriptLibraryRefreshed", { count: result.data?.length ?? 0 }))
    }
  }

  const applyScript = (script: Script, execute: boolean) => {
    if (!canExecute || scriptsQuery.isError || !script.content.trim()) return
    if (!execute && /[\r\n]/.test(script.content.trimEnd())) return
    if (!onApplyScript(script.content, execute)) return
    restoreTerminalFocus.current = true
    setOpen(false)
    if (execute) {
      // 此接口只记录使用次数；脚本已经发送到当前终端，计数失败不重发。
      void client.execute(script.id).then(() => (
        queryClient.invalidateQueries({ queryKey: queryKeys.scripts.all })
      )).catch(() => {
        toast.error(t("scriptLibraryCountFailed"))
      })
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "size-6 rounded-md text-foreground transition-colors hover:bg-accent/80 hover:text-accent-foreground",
            open && "bg-accent text-accent-foreground",
          )}
          aria-label={t("scriptLibraryTitle")}
          title={t("scriptLibraryTitle")}
        >
          <FileCode2 className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        aria-label={t("scriptLibraryTitle")}
        className="flex max-h-[var(--radix-popover-content-available-height)] w-[560px] max-w-[calc(100vw-24px)] flex-col overflow-hidden p-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          searchInputRef.current?.focus()
        }}
        onCloseAutoFocus={(event) => {
          if (!restoreTerminalFocus.current) return
          event.preventDefault()
          restoreTerminalFocus.current = false
          onFocusTerminal()
        }}
      >
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <FileCode2 className="size-4 shrink-0" />
          <span className="flex-1 text-sm font-medium">{t("scriptLibraryTitle")}</span>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={t("common:refresh")}
            title={t("common:refresh")}
            disabled={scriptsQuery.isFetching}
            onClick={() => void refreshScripts()}
          >
            <RefreshCw className={cn("size-3.5", scriptsQuery.isFetching && "animate-spin")} />
          </Button>
          <Button variant="ghost" size="icon" className="size-7" aria-label={t("scriptLibraryClose")} onClick={() => setOpen(false)}>
            <X className="size-4" />
          </Button>
        </div>
        <div className="relative m-3">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("scriptLibrarySearch")}
            aria-label={t("scriptLibrarySearch")}
            className="pl-9"
          />
        </div>
        {scriptsQuery.isPending ? (
          <div role="status" className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t("common:loading")}
          </div>
        ) : scriptsQuery.isError ? (
          <div role="alert" className="space-y-3 p-6 text-center text-sm">
            <p className="text-destructive">{t("scriptLibraryLoadFailed")}</p>
            <Button variant="outline" size="sm" disabled={scriptsQuery.isFetching} onClick={() => void refreshScripts()}>{t("common:retry")}</Button>
          </div>
        ) : scripts.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            {t(search.trim() ? "scriptLibraryNoResults" : "scriptLibraryEmpty")}
          </p>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-2 border-t">
            <div className="max-h-[360px] overflow-y-auto border-r p-1.5" aria-label={t("scriptLibraryTitle")}>
              {scripts.map((script) => {
                const isMultiline = /[\r\n]/.test(script.content.trimEnd())
                const disabled = !canExecute || !script.content.trim() || scriptsQuery.isError
                return (
                  <div
                    key={script.id}
                    className={cn(
                      "mb-1 flex items-center gap-1 rounded-md pr-1 text-sm transition-colors hover:bg-accent",
                      script.id === selected?.id && "bg-accent text-accent-foreground",
                    )}
                  >
                    <button
                      type="button"
                      aria-pressed={script.id === selected?.id}
                      onClick={() => setSelectedId(script.id)}
                      className="min-w-0 flex-1 rounded-md p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="truncate font-medium" title={script.name}>{script.name}</div>
                      <div className="mt-1 line-clamp-2 break-all text-xs text-muted-foreground">{script.description || script.content}</div>
                    </button>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7"
                              aria-label={`${t("scriptLibraryInsert")}：${script.name}`}
                              disabled={disabled || isMultiline}
                              onClick={() => applyScript(script, false)}
                            >
                              <TextCursorInput className="size-3.5" />
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t(isMultiline ? "scriptLibraryMultilineInsertHint" : "scriptLibraryInsert")}
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7"
                              aria-label={`${t("scriptLibraryExecute")}：${script.name}`}
                              disabled={disabled}
                              onClick={() => applyScript(script, true)}
                            >
                              <Play className="size-3.5" />
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>{t("scriptLibraryExecute")}</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                )
              })}
            </div>
            {selected && (
              <div className="flex max-h-[360px] min-w-0 flex-col gap-2 overflow-y-auto p-3">
                <div className="break-words text-sm font-medium">{selected.name}</div>
                {selected.description && <p className="break-words text-xs text-muted-foreground">{selected.description}</p>}
                {selected.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {selected.tags.map((tag) => <span key={tag} className="max-w-full truncate rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{tag}</span>)}
                  </div>
                )}
                <pre className="min-h-24 shrink-0 overflow-x-auto rounded-md bg-muted/60 p-2.5 font-mono text-xs leading-relaxed"><code>{selected.content}</code></pre>
              </div>
            )}
          </div>
        )}
        <div className="border-t px-3 py-2.5">
          <p className="truncate text-xs text-muted-foreground" title={sessionLabel}>
            {canExecute ? t("scriptLibraryTarget", { name: sessionLabel }) : t("scriptLibraryDisconnected")}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  )
}
