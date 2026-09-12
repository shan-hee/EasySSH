import { shortcutFromEvent } from "./terminal-shortcuts"

import { useState, useRef } from "react"
import { Input } from "@/components/ui/input"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTranslation } from "react-i18next"

interface KeyboardShortcutInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  id?: string
}

export function KeyboardShortcutInput({
  value,
  onChange,
  placeholder,
  id,
}: KeyboardShortcutInputProps) {
  const [isFocused, setIsFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const { t: tTerminalSettings } = useTranslation("terminalSettings")

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isFocused) return

    if (e.key === "Tab" || e.key === "Escape") return
    e.preventDefault()
    e.stopPropagation()

    const shortcut = shortcutFromEvent(e)
    if (shortcut) onChange(shortcut)
  }

  const handleFocus = () => {
    setIsFocused(true)
  }

  const handleBlur = () => {
    setIsFocused(false)
  }

  const handleClear = () => {
    onChange("")
    inputRef.current?.focus()
  }

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        id={id}
        type="text"
        value={value}
        readOnly
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={
          isFocused
            ? tTerminalSettings("shortcutsRecordPlaceholder")
            : (placeholder ?? tTerminalSettings("shortcutsPlaceholder"))
        }
        className="pr-8 cursor-text"
      />
      {value && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 hover:bg-muted"
          onClick={handleClear}
          aria-label={tTerminalSettings("shortcutRemove")}
        >
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  )
}
