
import { startTransition } from "react"
import { Eye, EyeOff, LayoutGrid, List, RefreshCw, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useWorkspaceSftpTranslator } from "@/components/ssh-workspace/use-workspace-translator"
import { cn } from "@/lib/utils"

export interface SftpFileToolbarProps {
  viewMode: "grid" | "list"
  onViewModeChange: (mode: "grid" | "list") => void
  searchTerm: string
  onSearchTermChange: (value: string) => void
  showHidden: boolean
  onToggleHidden: () => void
  selectedCount: number
  onRefresh: () => void
}

export function SftpFileToolbar({
  viewMode,
  onViewModeChange,
  searchTerm,
  onSearchTermChange,
  showHidden,
  onToggleHidden,
  selectedCount,
  onRefresh,
}: SftpFileToolbarProps) {
  const tSftp = useWorkspaceSftpTranslator()

  return (
    <div className="px-3 py-2 border-b flex items-center gap-2">
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-7 w-7 rounded-md transition-all duration-200",
            viewMode === "grid"
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
          onClick={() => {
            startTransition(() => {
              onViewModeChange("grid")
            })
          }}
          title={tSftp("viewGridTooltip")}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-7 w-7 rounded-md transition-all duration-200",
            viewMode === "list"
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
          )}
          onClick={() => {
            startTransition(() => {
              onViewModeChange("list")
            })
          }}
          title={tSftp("viewListTooltip")}
        >
          <List className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="relative flex-1 max-w-xs">
        <Search className={cn(
          "absolute left-2.5 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground",
        )} />
        <Input
          placeholder={tSftp("searchPlaceholder")}
          className={cn(
            "h-7 pl-8 pr-2 text-xs border-0 bg-muted",
          )}
          value={searchTerm}
          onChange={(event) => onSearchTermChange(event.target.value)}
        />
      </div>

      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "h-7 w-7 rounded-md transition-all duration-200",
          showHidden
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        )}
        onClick={() => {
          startTransition(() => {
            onToggleHidden()
          })
        }}
        title={showHidden ? tSftp("toggleHiddenOn") : tSftp("toggleHiddenOff")}
      >
        {showHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "h-7 w-7 rounded-md transition-all duration-200 text-muted-foreground hover:scale-105 hover:bg-accent hover:text-accent-foreground",
        )}
        onClick={onRefresh}
        title={tSftp("contextRefresh")}
      >
        <RefreshCw className="h-3.5 w-3.5" />
      </Button>

      {selectedCount > 0 && (
        <div
          className={cn(
            "flex items-center gap-2 text-xs px-2 py-1 rounded-md bg-primary/10 text-primary",
          )}
        >
          <span>{tSftp("selectedCount", { count: selectedCount })}</span>
        </div>
      )}
    </div>
  )
}
