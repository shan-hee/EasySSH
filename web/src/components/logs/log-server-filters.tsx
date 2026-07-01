import * as React from "react"
import { CheckIcon, PlusCircledIcon } from "@radix-ui/react-icons"
import { CalendarIcon } from "lucide-react"
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
import { Separator } from "@/components/ui/separator"

export interface ServerFilterOption {
  label: string
  value: string
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
}: {
  title: string
  values: string[]
  options: ServerFilterOption[]
  selectedLabel: (count: number) => string
  clearLabel: string
  emptyLabel: string
  onValuesChange: (values: string[]) => void
}) {
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
    const nextValues = new Set(selectedValues)
    if (nextValues.has(value)) {
      nextValues.delete(value)
    } else {
      nextValues.add(value)
    }
    onValuesChange(Array.from(nextValues))
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 w-full justify-start border-dashed sm:w-auto">
          <PlusCircledIcon className="mr-2 h-4 w-4" />
          {title}
          {values.length > 0 ? (
            <>
              <Separator orientation="vertical" className="mx-2 h-4" />
              <Badge variant="secondary" className="rounded-sm px-1 font-normal lg:hidden">
                {values.length}
              </Badge>
              <div className="hidden space-x-1 lg:flex">
                {values.length > 2 ? (
                  <Badge variant="secondary" className="rounded-sm px-1 font-normal">
                    {selectedLabel(values.length)}
                  </Badge>
                ) : (
                  options
                    .filter((option) => selectedValues.has(option.value))
                    .map((option) => (
                      <Badge variant="secondary" key={option.value} className="rounded-sm px-1 font-normal">
                        {option.label}
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
                <CommandItem key={option.value} value={option.value} onSelect={() => toggleValue(option.value)}>
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
        <Button variant="outline" size="sm" className="h-8 w-full justify-start border-dashed sm:w-auto">
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
