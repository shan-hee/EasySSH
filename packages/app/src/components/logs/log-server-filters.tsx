import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { CheckIcon, PlusCircledIcon } from "@radix-ui/react-icons"
import { CalendarIcon, Search, X } from "lucide-react"
import type { DateRange } from "react-day-picker"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import type { serversApi } from "@/lib/api/servers"
import { queryKeys } from "@/lib/query-keys"
import { getServerDisplayName, loadAllServers } from "@/lib/server-utils"

export interface ServerFilterOption {
  label: string
  value: string
}

export interface LogFilterValues {
  type: string[]
  category: string[]
  status: string[]
  server_id: string
  source: string
  ip: string
  keyword: string
  start_date: string
  end_date: string
}

export function createLogFilters(type: string[] = []): LogFilterValues {
  return {
    type,
    category: [],
    status: [],
    server_id: "",
    source: "",
    ip: "",
    keyword: "",
    start_date: "",
    end_date: "",
  }
}

export function hasActiveLogFilters(filters: LogFilterValues) {
  return Object.values(filters).some((value) => (
    Array.isArray(value) ? value.length > 0 : value.trim() !== ""
  ))
}

export type LogServersApi = Pick<typeof serversApi, "list">

/** 服务器筛选的选项；Web 与桌面端各自传入服务器列表接口。 */
export function useLogServerOptions(api: LogServersApi, enabled: boolean) {
  const query = useQuery({
    queryKey: queryKeys.logs.servers,
    queryFn: () => loadAllServers((params) => api.list(params)),
    enabled,
    staleTime: 60_000,
  })
  return React.useMemo<ServerFilterOption[]>(
    () => (query.data ?? []).map((server) => ({ label: getServerDisplayName(server), value: server.id })),
    [query.data],
  )
}

function parseDateValue(value: string) {
  if (!value) return null
  const [year, month, day] = value.split("-").map(Number)
  if (!year || !month || !day) return null
  const date = new Date(year, month - 1, day)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatDateValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function LogServerFilterButton({
  title,
  values,
  options,
  selectedLabel,
  clearLabel,
  emptyLabel,
  onValuesChange,
  single = false,
}: {
  title: string
  values: string[]
  options: ServerFilterOption[]
  selectedLabel: (count: number) => string
  clearLabel: string
  emptyLabel: string
  onValuesChange: (values: string[]) => void
  /** 单选：选中即替换并关闭弹层，再次点击已选项取消选择。 */
  single?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const selectedValues = React.useMemo(() => new Set(values), [values])

  const renderCheck = (checked: boolean) => (
    <div
      className={cn(
        "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
        checked ? "bg-primary text-primary-foreground" : "opacity-50 [&_svg]:invisible"
      )}
    >
      <CheckIcon className="h-4 w-4" />
    </div>
  )

  const toggleValue = (value: string) => {
    if (single) {
      onValuesChange(selectedValues.has(value) ? [] : [value])
      setOpen(false)
      return
    }
    const nextValues = new Set(selectedValues)
    if (nextValues.has(value)) {
      nextValues.delete(value)
    } else {
      nextValues.add(value)
    }
    onValuesChange(Array.from(nextValues))
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 max-w-full justify-start border-dashed">
          <PlusCircledIcon className="mr-2 h-4 w-4" />
          {title}
          {values.length > 0 ? (
            <>
              <Separator orientation="vertical" className="mx-2 h-4" />
              <div className="flex min-w-0 gap-1">
                {values.length > 2 ? (
                  <Badge variant="secondary" className="rounded-sm px-1 font-normal">
                    {selectedLabel(values.length)}
                  </Badge>
                ) : (
                  options
                    .filter((option) => selectedValues.has(option.value))
                    .map((option) => (
                      <Badge variant="secondary" key={option.value} className="max-w-32 rounded-sm px-1 font-normal">
                        <span className="truncate">{option.label}</span>
                      </Badge>
                    ))
                )}
              </div>
            </>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-0" align="start">
        <Command>
          <CommandInput placeholder={title} />
          <CommandList>
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem key={option.value} value={option.value} keywords={[option.label]} onSelect={() => toggleValue(option.value)}>
                  {renderCheck(selectedValues.has(option.value))}
                  <span>{option.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            {values.length > 0 ? (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem onSelect={() => onValuesChange([])} className="justify-center text-center">
                    {clearLabel}
                  </CommandItem>
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function LogDateRangeFilterButton({
  title,
  startValue,
  endValue,
  onRangeChange,
  clearLabel,
  todayLabel,
}: {
  title: string
  startValue: string
  endValue: string
  onRangeChange: (range: { start: string; end: string }) => void
  clearLabel: string
  todayLabel: string
}) {
  const startDate = React.useMemo(() => parseDateValue(startValue), [startValue])
  const endDate = React.useMemo(() => parseDateValue(endValue), [endValue])
  const anchorDate = React.useMemo(() => startDate || endDate || new Date(), [endDate, startDate])
  const [open, setOpen] = React.useState(false)
  const [month, setMonth] = React.useState(() => new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1))
  const selectedRange = React.useMemo<DateRange | undefined>(() => (
    startDate || endDate
      ? { from: startDate ?? undefined, to: endDate ?? undefined }
      : undefined
  ), [endDate, startDate])

  React.useEffect(() => {
    if (open) {
      setMonth(new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1))
    }
  }, [anchorDate, open])

  const today = new Date()

  const rangeLabel = startValue && endValue
    ? `${startValue} - ${endValue}`
    : startValue || endValue

  const selectRange = (range: DateRange | undefined) => {
    onRangeChange({
      start: range?.from ? formatDateValue(range.from) : "",
      end: range?.to ? formatDateValue(range.to) : "",
    })
    if (range?.from && range.to) {
      setOpen(false)
    }
  }

  const selectToday = () => {
    const value = formatDateValue(today)
    onRangeChange({ start: value, end: value })
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 max-w-full justify-start border-dashed">
          <CalendarIcon className="mr-2 h-4 w-4" />
          {title}
          {rangeLabel ? (
            <>
              <Separator orientation="vertical" className="mx-2 h-4" />
              <Badge variant="secondary" className="rounded-sm px-1 font-normal">
                {rangeLabel}
              </Badge>
            </>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          selected={selectedRange}
          month={month}
          onMonthChange={setMonth}
          onSelect={selectRange}
          defaultMonth={anchorDate}
          numberOfMonths={1}
        />
        <div className="flex items-center justify-between border-t px-3 pb-3 pt-3">
          <Button type="button" variant="ghost" size="sm" className="h-8" onClick={selectToday}>
            {todayLabel}
          </Button>
          {rangeLabel ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={() => {
                onRangeChange({ start: "", end: "" })
                setOpen(false)
              }}
            >
              {clearLabel}
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * 日志页共用的服务端筛选栏。控件宽度固定、清除按钮常驻（无筛选时禁用），
 * 输入筛选条件时工具栏不会因按钮出现而重新换行。
 */
export function LogFilterBar({
  filters,
  onFiltersChange,
  onApply,
  onReset,
  canReset,
  typeOptions,
  categoryOptions,
  statusOptions,
  serverOptions,
  showOriginFilters = true,
  t,
}: {
  filters: LogFilterValues
  onFiltersChange: React.Dispatch<React.SetStateAction<LogFilterValues>>
  onApply: () => void
  onReset: () => void
  canReset: boolean
  typeOptions: ServerFilterOption[]
  /** 不传时隐藏分类筛选。 */
  categoryOptions?: ServerFilterOption[]
  statusOptions: ServerFilterOption[]
  /** 不传时隐藏服务器筛选。 */
  serverOptions?: ServerFilterOption[]
  /** 是否显示来源与 IP 输入框。 */
  showOriginFilters?: boolean
  t: (key: string, options?: Record<string, unknown>) => string
}) {
  const updateFilter = <K extends keyof LogFilterValues>(key: K, value: LogFilterValues[K]) => {
    onFiltersChange((current) => ({ ...current, [key]: value }))
  }

  const handleKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (event) => {
    if (event.key === "Enter") onApply()
  }

  const optionFilter = (key: "type" | "category" | "status", title: string, options: ServerFilterOption[]) => (
    <LogServerFilterButton
      title={title}
      values={filters[key]}
      options={options}
      selectedLabel={(count) => t("filterSelectedCount", { count })}
      clearLabel={t("clearServerFilters")}
      emptyLabel={t("filterEmpty")}
      onValuesChange={(values) => updateFilter(key, values)}
    />
  )

  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <Input
        value={filters.keyword}
        placeholder={t("filterKeywordPlaceholder")}
        onChange={(event) => updateFilter("keyword", event.target.value)}
        onKeyDown={handleKeyDown}
        className="h-8 w-[220px] max-w-full"
      />
      {optionFilter("type", t("filterTypeTitle"), typeOptions)}
      {categoryOptions ? optionFilter("category", t("filterCategoryTitle"), categoryOptions) : null}
      {optionFilter("status", t("filterStatusTitle"), statusOptions)}
      {serverOptions ? (
        <LogServerFilterButton
          single
          title={t("filterServerTitle")}
          values={filters.server_id ? [filters.server_id] : []}
          options={serverOptions}
          selectedLabel={(count) => t("filterSelectedCount", { count })}
          clearLabel={t("clearServerFilters")}
          emptyLabel={t("filterEmpty")}
          onValuesChange={(values) => updateFilter("server_id", values[0] ?? "")}
        />
      ) : null}
      {showOriginFilters ? (
        <>
          <Input
            value={filters.source}
            placeholder={t("filterSourcePlaceholder")}
            onChange={(event) => updateFilter("source", event.target.value)}
            onKeyDown={handleKeyDown}
            className="h-8 w-[150px] max-w-full"
          />
          <Input
            value={filters.ip}
            placeholder={t("filterIpPlaceholder")}
            onChange={(event) => updateFilter("ip", event.target.value)}
            onKeyDown={handleKeyDown}
            className="h-8 w-[150px] max-w-full"
          />
        </>
      ) : null}
      <LogDateRangeFilterButton
        title={t("filterDateRange")}
        startValue={filters.start_date}
        endValue={filters.end_date}
        onRangeChange={(range) => {
          onFiltersChange((current) => ({ ...current, start_date: range.start, end_date: range.end }))
        }}
        clearLabel={t("clearServerFilters")}
        todayLabel={t("filterToday")}
      />
      <Button type="button" size="sm" className="h-8" onClick={onApply}>
        <Search className="mr-2 h-4 w-4" />
        {t("applyFilters")}
      </Button>
      <Button type="button" variant="ghost" size="sm" className="h-8" disabled={!canReset} onClick={onReset}>
        <X className="mr-2 h-4 w-4" />
        {t("clearServerFilters")}
      </Button>
    </div>
  )
}
