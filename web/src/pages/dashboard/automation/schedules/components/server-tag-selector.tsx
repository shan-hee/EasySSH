import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { X, Search, Plus } from "lucide-react"
import { CreatableCombobox } from "@/components/ui/creatable-combobox"
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

  const onlineServers = servers.filter((s) => s.status === "online")
  const selectedServers = onlineServers.filter((s) => selectedIds.includes(s.id))
  const availableServers = onlineServers.filter((s) => !selectedIds.includes(s.id))
  const serverOptions = availableServers.map((server) => ({
    value: server.id,
    searchValue: `${server.name ?? ""} ${server.host}`,
    label: server.name || server.host,
    description: server.name ? server.host : undefined,
  }))

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
        <CreatableCombobox
          value={searchTerm}
          onValueChange={setSearchTerm}
          options={serverOptions}
          onSelect={handleAdd}
          placeholder={t("serverTagSearchPlaceholder")}
          emptyText={t("serverTagNoMatch")}
          allowCreate={false}
          leadingIcon={<Search className="h-4 w-4" />}
          renderOption={(option) => (
            <>
              <div className="min-w-0 flex-1 text-left">
                <div className="truncate font-medium">{option.label}</div>
                {option.description && (
                  <div className="truncate text-xs text-muted-foreground">{option.description}</div>
                )}
              </div>
              <Plus className="h-4 w-4 text-muted-foreground" />
            </>
          )}
        />
      )}
    </div>
  )
}
