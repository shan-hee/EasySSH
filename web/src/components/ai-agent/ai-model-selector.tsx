import { useMemo, useState } from "react"
import { Check, ChevronsUpDown, Plus, Search, Trash2, X, Loader2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export interface AIModelSelectorLabels {
  label: string
  manualPlaceholder: string
  description?: string
  probe: string
  probing: string
  clear: string
  selectPlaceholder: string
  selectSummary: (availableCount: number, selectedCount: number) => string
  noOptions: string
  createModel: (value: string) => string
}

interface AIModelSelectorProps {
  value: string
  availableModels: string[]
  onChange: (value: string) => void
  onProbe: () => void
  probing?: boolean
  disabled?: boolean
  compact?: boolean
  labels: AIModelSelectorLabels
}

export function parseAIModels(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((model) => model.trim())
        .filter(Boolean),
    ),
  )
}

export function AIModelSelector({
  value,
  availableModels,
  onChange,
  onProbe,
  probing = false,
  disabled = false,
  compact = false,
  labels,
}: AIModelSelectorProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const selectedModels = useMemo(() => parseAIModels(value), [value])
  const modelOptions = useMemo(
    () => Array.from(new Set([...availableModels, ...selectedModels])).sort((a, b) => a.localeCompare(b)),
    [availableModels, selectedModels],
  )
  const filteredModels = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return modelOptions
    return modelOptions.filter((model) => model.toLowerCase().includes(normalizedQuery))
  }, [modelOptions, query])
  const canCreateModel = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return !!normalizedQuery && !modelOptions.some((model) => model.toLowerCase() === normalizedQuery)
  }, [modelOptions, query])

  const setSelectedModels = (models: string[]) => {
    onChange(Array.from(new Set(models.map((model) => model.trim()).filter(Boolean))).join(","))
  }

  const toggleModel = (model: string, checked: boolean) => {
    setSelectedModels(
      checked
        ? [...selectedModels, model]
        : selectedModels.filter((selected) => selected !== model),
    )
  }

  const addCustomModel = () => {
    const model = query.trim()
    if (!model) return
    setSelectedModels([...selectedModels, model])
    setQuery("")
  }

  return (
    <div className={cn("space-y-3", compact && "space-y-2")}>
      <div className="flex items-center justify-between gap-2">
        <Label className={cn(compact && "text-xs")}>{labels.label}</Label>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "h-auto px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground",
              compact && "px-1.5",
            )}
            onClick={onProbe}
            disabled={disabled || probing}
          >
            {probing ? (
              <Loader2 className="mr-1 size-3 animate-spin" />
            ) : (
              <Search className="mr-1 size-3" />
            )}
            {probing ? labels.probing : labels.probe}
          </Button>
          {selectedModels.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                "h-auto px-2 py-0.5 text-xs text-destructive hover:text-destructive",
                compact && "px-1.5",
              )}
              onClick={() => setSelectedModels([])}
              disabled={disabled}
            >
              <Trash2 className="mr-1 size-3" />
              {labels.clear}
            </Button>
          )}
        </div>
      </div>

      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen)
          if (!nextOpen) setQuery("")
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              "w-full justify-between px-3 font-normal",
              compact ? "h-8 text-xs" : "h-9 text-sm",
            )}
            disabled={disabled}
          >
            <span className="truncate text-muted-foreground">
              {availableModels.length > 0 || selectedModels.length > 0
                ? labels.selectSummary(availableModels.length, selectedModels.length)
                : labels.selectPlaceholder}
            </span>
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={4}
          className="w-[var(--radix-popover-trigger-width)] min-w-[280px] overflow-hidden p-0"
        >
          <Command shouldFilter={false}>
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder={labels.manualPlaceholder}
              className={cn(compact && "h-8 text-xs")}
            />
            <CommandList className="max-h-72">
              {filteredModels.length === 0 && !canCreateModel && (
                <CommandEmpty>{labels.noOptions}</CommandEmpty>
              )}
              {filteredModels.length > 0 && (
                <CommandGroup>
                  {filteredModels.map((model) => {
                    const selected = selectedModels.includes(model)
                    return (
                      <CommandItem
                        key={model}
                        value={model}
                        onSelect={() => toggleModel(model, !selected)}
                        className="gap-2 font-mono text-xs"
                      >
                        <Check className={cn("size-3.5", selected ? "opacity-100" : "opacity-0")} />
                        <span className="truncate">{model}</span>
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              )}
              {canCreateModel && (
                <CommandGroup>
                  <CommandItem
                    value={`create-${query.trim()}`}
                    onSelect={addCustomModel}
                    className="gap-2 text-xs"
                  >
                    <Plus className="size-3.5 text-muted-foreground" />
                    <span className="truncate">{labels.createModel(query.trim())}</span>
                  </CommandItem>
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selectedModels.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedModels.map((model) => (
            <Badge key={model} variant="secondary" className="max-w-full gap-1 font-mono text-xs">
              <Check className="size-3 shrink-0" />
              <span className="truncate">{model}</span>
              <button
                type="button"
                onClick={() => toggleModel(model, false)}
                className="ml-0.5 shrink-0 hover:text-destructive"
                disabled={disabled}
                aria-label={`${labels.clear} ${model}`}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {labels.description && (
        <p className={cn("text-xs text-muted-foreground", compact && "text-[11px]")}>{labels.description}</p>
      )}
    </div>
  )
}
