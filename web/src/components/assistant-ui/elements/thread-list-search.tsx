"use client"

// Search control from the official thread-list registry, usable with server-side search.
import { forwardRef, type ComponentPropsWithoutRef } from "react"
import { SearchIcon } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export const ThreadListSearch = forwardRef<
  HTMLInputElement,
  Omit<ComponentPropsWithoutRef<typeof Input>, "value" | "onChange"> & {
    value: string
    onValueChange: (value: string) => void
  }
>(({ className, value, onValueChange, ...props }, ref) => (
  <div data-slot="aui_thread-list-search" className="relative px-0.5 py-1">
    <SearchIcon
      aria-hidden
      className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
    />
    <Input
      ref={ref}
      type="search"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      className={cn("h-8 ps-8 text-sm", className)}
      {...props}
    />
  </div>
))
ThreadListSearch.displayName = "ThreadListSearch"
