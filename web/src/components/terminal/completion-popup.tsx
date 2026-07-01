import { useEffect, useLayoutEffect, useRef, useCallback, useState } from "react"
import { createPortal } from "react-dom"
import {
  Command as CommandIcon,
  Clock3,
  Cloud,
  FileText,
  Sparkles,
} from "lucide-react"
import {
  Command,
  CommandList,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command"
import type { CompletionItem } from "@/lib/completion/types"
import { useTerminalTheme } from "@/contexts/terminal-theme-context"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { useSynchronousSelectedItemScroll } from "@/hooks/use-synchronous-selected-item-scroll"

type Placement = "top" | "bottom"

interface CompletionPopupProps {
  items: CompletionItem[]
  selectedIndex: number
  position: { x: number; y: number; lineTop?: number; lineBottom?: number }
  matchedPrefix: string
  showIcon?: boolean
  onSelect: (item: CompletionItem, index: number) => void
  onClose: () => void
  onSelectedIndexChange?: (index: number) => void
  onPlacementChange?: (placement: Placement) => void
}

const sourceLabelKey: Record<CompletionItem["source"], string> = {
  local: "completionSourceLocal",
  remote: "completionSourceRemote",
  history: "completionSourceHistory",
  script: "completionSourceScript",
  ai: "completionSourceAi",
}

const POPUP_OFFSET = 4
const COLLISION_PADDING = 8

/**
 * 高亮匹配的前缀
 */
function HighlightedText({
  text,
  prefix,
  highlightColor,
}: {
  text: string
  prefix: string
  highlightColor: string
}) {
  if (!prefix || !text.toLowerCase().startsWith(prefix.toLowerCase())) {
    return <span>{text}</span>
  }

  const matched = text.slice(0, prefix.length)
  const remaining = text.slice(prefix.length)

  return (
    <>
      <span className="font-semibold" style={{ color: highlightColor }}>
        {matched}
      </span>
      <span>{remaining}</span>
    </>
  )
}

function getCompletionIcon(item: CompletionItem) {
  if (item.providerName === "session") {
    return Clock3
  }
  if (item.source === "ai") {
    return Sparkles
  }
  if (item.source === "remote") {
    return Cloud
  }
  if (item.source === "history") {
    return Clock3
  }
  if (item.source === "script") {
    return FileText
  }
  return CommandIcon
}

export function CompletionPopup({
  items,
  selectedIndex,
  position,
  matchedPrefix,
  showIcon = true,
  onSelect,
  onClose,
  onSelectedIndexChange,
  onPlacementChange,
}: CompletionPopupProps) {
  const theme = useTerminalTheme()
  const { t } = useTranslation("terminal")
  const popupRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const [placement, setPlacement] = useState<Placement>("bottom")
  const [popupPosition, setPopupPosition] = useState({
    left: position.x,
    top: position.y + POPUP_OFFSET,
  })

  const getSelectedElement = useCallback(
    () => itemRefs.current.get(selectedIndex),
    [selectedIndex],
  )

  useSynchronousSelectedItemScroll({
    getSelectedElement,
    listRef,
    selectedKey: selectedIndex,
  })

  const handleMouseMove = useCallback(
    (index: number) => {
      if (onSelectedIndexChange) {
        onSelectedIndexChange(index)
      }
    },
    [onSelectedIndexChange]
  )

  useEffect(() => {
    if (typeof document === "undefined") {
      return
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target
      if (target instanceof Node && popupRef.current?.contains(target)) {
        return
      }

      onClose()
    }

    document.addEventListener("mousedown", handlePointerDown)
    return () => document.removeEventListener("mousedown", handlePointerDown)
  }, [onClose])

  useLayoutEffect(() => {
    const popupElement = popupRef.current
    if (!popupElement || typeof window === "undefined") {
      return
    }

    const rect = popupElement.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const bottomTop = position.y + POPUP_OFFSET
    const topAnchor = position.lineTop ?? position.y
    const topTop = topAnchor - rect.height - POPUP_OFFSET
    const spaceBelow = viewportHeight - bottomTop - COLLISION_PADDING
    const spaceAbove = topAnchor - COLLISION_PADDING
    const nextPlacement: Placement =
      rect.height > spaceBelow && spaceAbove > spaceBelow ? "top" : "bottom"
    const rawTop = nextPlacement === "top" ? topTop : bottomTop
    const maxLeft = viewportWidth - rect.width - COLLISION_PADDING
    const nextPosition = {
      left: Math.max(COLLISION_PADDING, Math.min(position.x, maxLeft)),
      top: Math.max(
        COLLISION_PADDING,
        Math.min(rawTop, viewportHeight - rect.height - COLLISION_PADDING)
      ),
    }

    setPopupPosition((current) => (
      current.left === nextPosition.left && current.top === nextPosition.top
        ? current
        : nextPosition
    ))

    if (nextPlacement !== placement) {
      setPlacement(nextPlacement)
      onPlacementChange?.(nextPlacement)
    }
  }, [items.length, onPlacementChange, placement, position.lineTop, position.x, position.y])

  if (items.length === 0) {
    return null
  }

  if (typeof document === "undefined") {
    return null
  }

  // 当弹窗在上方时，反转列表顺序
  const displayItems = placement === "top" ? [...items].reverse() : items
  const selectedCommandValue = items[selectedIndex]
    ? `${items[selectedIndex].text}-${selectedIndex}`
    : ""

  return createPortal(
    <div
      ref={popupRef}
      data-completion-popup
      className={cn(
        "fixed z-[80] w-auto min-w-[320px] max-w-[550px] overflow-hidden flex rounded-lg border shadow-md outline-hidden",
        placement === "top" ? "flex-col-reverse" : "flex-col"
      )}
      style={{
        left: popupPosition.left,
        top: popupPosition.top,
        backgroundColor: theme.background,
        color: theme.foreground,
      }}
      onMouseDown={(e) => e.preventDefault()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <Command
        className="bg-transparent"
        // 禁用 cmdk 内置的键盘导航，由终端组件处理
        disablePointerSelection
        loop={false}
        value={selectedCommandValue}
      >
        <CommandList
          ref={listRef}
          className="max-h-[240px] overflow-y-auto scrollbar-custom"
        >
          <CommandGroup className="p-0">
            {displayItems.map((item, displayIndex) => {
              // 计算原始索引
              const originalIndex =
                placement === "top"
                  ? items.length - 1 - displayIndex
                  : displayIndex
              const isSelected = originalIndex === selectedIndex

              return (
                <CommandItem
                  key={`${item.text}-${originalIndex}`}
                  value={`${item.text}-${originalIndex}`}
                  data-selected={isSelected}
                  ref={(el) => {
                    if (el) {
                      itemRefs.current.set(originalIndex, el)
                    } else {
                      itemRefs.current.delete(originalIndex)
                    }
                  }}
                  onSelect={() => onSelect(item, originalIndex)}
                  onMouseMove={() => handleMouseMove(originalIndex)}
                  className={cn(
                    "flex items-center gap-3 px-3 py-1.5 cursor-pointer rounded-none",
                    "data-[selected=true]:bg-transparent aria-selected:bg-transparent", // 禁用 cmdk 默认选中样式
                    "bg-transparent"
                  )}
                  style={{
                    backgroundColor: isSelected ? theme.selectionBackground : "transparent",
                  }}
                >
                  {/* 图标 */}
                  {showIcon && (
                    <div
                      className="flex-shrink-0 opacity-70"
                      title={t(sourceLabelKey[item.source])}
                      aria-label={t(sourceLabelKey[item.source])}
                    >
                      {(() => {
                        const Icon = getCompletionIcon(item)
                        return <Icon className="h-3.5 w-3.5" />
                      })()}
                    </div>
                  )}

                  {/* 主文本 */}
                  <div className="flex-1 min-w-0 font-mono text-sm">
                    <HighlightedText
                      text={item.displayText || item.text}
                      prefix={matchedPrefix}
                      highlightColor={theme.green || "#22c55e"}
                    />
                  </div>
                </CommandItem>
              )
            })}
          </CommandGroup>
        </CommandList>
      </Command>
    </div>,
    document.body
  )
}
