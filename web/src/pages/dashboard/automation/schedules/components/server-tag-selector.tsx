import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { X, Search, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Server } from "@/lib/api"

interface ServerTagSelectorProps {
  servers: Server[]
  selectedIds: string[]
  onSelectedChange: (ids: string[]) => void
  label?: string
  description?: string
  required?: boolean
  t: (key: string) => string
}

export function ServerTagSelector({
  servers,
  selectedIds,
  onSelectedChange,
  label,
  description,
  required = false,
  t,
}: ServerTagSelectorProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [isSearchOpen, setIsSearchOpen] = useState(false)

  const onlineServers = servers.filter((s) => s.status === "online")
  const selectedServers = onlineServers.filter((s) => selectedIds.includes(s.id))
  const availableServers = onlineServers.filter((s) => !selectedIds.includes(s.id))
  const filteredServers = availableServers.filter(
    (server) =>
      (server.name?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false) ||
      server.host.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const handleAdd = (serverId: string) => {
    if (!selectedIds.includes(serverId)) {
      onSelectedChange([...selectedIds, serverId])
    }
    setSearchTerm("")
  }

  const handleRemove = (serverId: string) => {
    onSelectedChange(selectedIds.filter((id) => id !== serverId))
  }

  const handleSelectAll = () => {
    onSelectedChange(onlineServers.map((s) => s.id))
    setIsSearchOpen(false)
  }

  const handleClearAll = () => {
    onSelectedChange([])
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">
          {label}
          {required && <span className="text-destructive ml-1">*</span>}
        </label>
        {selectedIds.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={handleClearAll}
          >
            {t("serverTagClearAll")}
          </Button>
        )}
      </div>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}

      {/* 已选服务器标签 */}
      <div className="min-h-[80px] rounded-lg border bg-muted/30 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-muted-foreground">
            {t("selectedServersCount")}: {selectedIds.length}
          </span>
          {selectedIds.length < onlineServers.length && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={handleSelectAll}
            >
              {t("selectAll")}
            </Button>
          )}
        </div>

        {selectedIds.length === 0 ? (
          <div className="flex items-center justify-center h-12 text-sm text-muted-foreground">
            {t("serverTagEmpty")}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {selectedServers.map((server) => (
              <Badge
                key={server.id}
                variant="secondary"
                className="pl-2 pr-1 py-1 text-xs gap-1 cursor-pointer hover:bg-secondary/80"
              >
                <span className="max-w-[120px] truncate">
                  {server.name || server.host}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemove(server.id)}
                  className="ml-1 rounded-full hover:bg-background/50 p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* 搜索和添加服务器 */}
      {availableServers.length > 0 && (
        <div className="relative">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t("serverTagSearchPlaceholder")}
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value)
                setIsSearchOpen(true)
              }}
              onFocus={() => setIsSearchOpen(true)}
              onBlur={() => {
                // 延迟关闭，让点击事件能够触发
                setTimeout(() => setIsSearchOpen(false), 200)
              }}
              className="pl-10"
            />
          </div>

          {/* 搜索结果下拉 - 绝对定位悬浮层 */}
          {isSearchOpen && searchTerm && (
            <div className="absolute z-50 w-full mt-1 rounded-md border bg-popover shadow-md max-h-[200px] overflow-y-auto scrollbar-custom">
              {filteredServers.length === 0 ? (
                <div className="p-3 text-sm text-muted-foreground text-center">
                  {t("serverTagNoMatch")}
                </div>
              ) : (
                <div className="p-1">
                  {filteredServers.map((server) => (
                    <button
                      key={server.id}
                      type="button"
                      onClick={() => handleAdd(server.id)}
                      className={cn(
                        "w-full flex items-center justify-between rounded-sm px-3 py-2 text-sm",
                        "hover:bg-accent hover:text-accent-foreground",
                        "transition-colors"
                      )}
                    >
                      <div className="text-left">
                        <div className="font-medium">{server.name || server.host}</div>
                        {server.name && (
                          <div className="text-xs text-muted-foreground">{server.host}</div>
                        )}
                      </div>
                      <Plus className="h-4 w-4 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
