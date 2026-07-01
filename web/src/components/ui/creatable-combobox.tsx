import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { Plus } from "lucide-react"

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export type CreatableComboboxOption = {
  value: string
  label?: ReactNode
  description?: ReactNode
  icon?: ReactNode
  searchValue?: string
}

type CreatableComboboxItem = {
  type: "option" | "create"
  value: string
  option?: CreatableComboboxOption
}

export interface CreatableComboboxProps {
  id?: string
  value: string
  onValueChange: (value: string) => void
  options: CreatableComboboxOption[]
  onSelect: (value: string) => void
  placeholder?: string
  emptyText?: ReactNode
  createLabel?: (value: string) => ReactNode
  allowCreate?: boolean
  leadingIcon?: ReactNode
  className?: string
  inputClassName?: string
  contentClassName?: string
  renderOption?: (option: CreatableComboboxOption) => ReactNode
}

const normalize = (value: string) => value.trim().toLowerCase()

export function CreatableCombobox({
  id,
  value,
  onValueChange,
  options,
  onSelect,
  placeholder,
  emptyText,
  createLabel,
  allowCreate = true,
  leadingIcon,
  className,
  inputClassName,
  contentClassName,
  renderOption,
}: CreatableComboboxProps) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])
  const query = value.trim()

  const filteredOptions = useMemo(() => {
    const normalizedQuery = normalize(value)
    if (!normalizedQuery) {
      return options
    }

    return options.filter((option) => {
      const target = normalize(`${option.value} ${option.searchValue ?? ""}`)
      return target.includes(normalizedQuery)
    })
  }, [options, value])

  const canCreate = useMemo(() => {
    if (!allowCreate || !query) {
      return false
    }

    return !options.some((option) => normalize(option.value) === normalize(query))
  }, [allowCreate, options, query])

  const items = useMemo<CreatableComboboxItem[]>(() => {
    const optionItems = filteredOptions.map((option) => ({
      type: "option" as const,
      value: option.value,
      option,
    }))

    if (!canCreate) {
      return optionItems
    }

    return [
      ...optionItems,
      {
        type: "create" as const,
        value: query,
      },
    ]
  }, [canCreate, filteredOptions, query])

  const visible = open && (items.length > 0 || !!emptyText)

  useEffect(() => {
    setActiveIndex(items.length > 0 ? 0 : -1)
    itemRefs.current = []
  }, [items.length, value])

  useEffect(() => {
    if (activeIndex < 0) return
    itemRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" })
  }, [activeIndex])

  const commit = (nextValue: string) => {
    const normalizedValue = nextValue.trim()
    if (!normalizedValue) return

    onSelect(normalizedValue)
    onValueChange("")
    setOpen(false)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((current) => {
        if (items.length === 0) return -1
        return current < items.length - 1 ? current + 1 : 0
      })
      return
    }

    if (event.key === "ArrowUp") {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((current) => {
        if (items.length === 0) return -1
        return current > 0 ? current - 1 : items.length - 1
      })
      return
    }

    if (event.key === "Enter") {
      event.preventDefault()
      const activeItem = items[activeIndex]
      if (activeItem) {
        commit(activeItem.value)
      } else if (allowCreate) {
        commit(value)
      }
      return
    }

    if (event.key === "Escape") {
      event.preventDefault()
      setOpen(false)
    }
  }

  return (
    <Popover open={visible} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className={cn("relative", className)}>
          {leadingIcon && (
            <div className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-muted-foreground">
              {leadingIcon}
            </div>
          )}
          <Input
            id={id}
            value={value}
            onChange={(event) => {
              onValueChange(event.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            role="combobox"
            aria-expanded={visible}
            aria-autocomplete="list"
            className={cn(leadingIcon && "pl-9", inputClassName)}
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={4}
        onOpenAutoFocus={(event) => event.preventDefault()}
        className={cn(
          "w-[var(--radix-popover-trigger-width)] overflow-hidden p-0",
          contentClassName
        )}
      >
        <Command shouldFilter={false}>
          <CommandList className="max-h-52">
            {items.length === 0 ? (
              <CommandEmpty>{emptyText}</CommandEmpty>
            ) : (
              <CommandGroup>
                {items.map((item, index) => (
                  <CommandItem
                    key={`${item.type}-${item.value}`}
                    ref={(element) => {
                      itemRefs.current[index] = element
                    }}
                    value={item.value}
                    onMouseEnter={() => setActiveIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onSelect={() => commit(item.value)}
                    className={cn(
                      "gap-2",
                      index === activeIndex && "bg-accent text-accent-foreground"
                    )}
                  >
                    {item.type === "create" ? (
                      <>
                        <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="truncate">
                          {createLabel ? createLabel(item.value) : item.value}
                        </span>
                      </>
                    ) : item.option ? (
                      renderOption ? (
                        renderOption(item.option)
                      ) : (
                        <>
                          {item.option.icon}
                          <span className="truncate">
                            {item.option.label ?? item.option.value}
                          </span>
                          {item.option.description && (
                            <span className="ml-auto truncate text-xs text-muted-foreground">
                              {item.option.description}
                            </span>
                          )}
                        </>
                      )
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
