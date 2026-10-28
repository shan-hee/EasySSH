import { useEffect, useRef, useState, type RefObject } from "react"
import { useTranslation } from "react-i18next"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { cn } from "@/lib/utils"

export interface ThreadNavigationEntry {
  id: string
  title: string
  preview: string
  index: number
}

export function ThreadNavigator({ entries, viewportRef, renderedStart, onNavigate }: {
  entries: ThreadNavigationEntry[]
  viewportRef: RefObject<HTMLDivElement | null>
  renderedStart: number
  onNavigate: (entry: ThreadNavigationEntry) => void
}) {
  const { t } = useTranslation("aiAssistant")
  const [activeId, setActiveId] = useState("")
  const navRef = useRef<HTMLElement>(null)
  const anchorKey = entries.map((entry) => entry.id).join("\n")

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    let frame = 0
    const update = () => {
      frame = 0
      const anchors = Array.from(viewport.querySelectorAll<HTMLElement>("[data-message-anchor]"))
      const threshold = viewport.getBoundingClientRect().top + viewport.clientHeight * 0.3
      let current = anchors[0]
      for (const anchor of anchors) {
        if (anchor.getBoundingClientRect().top > threshold) break
        current = anchor
      }
      if (viewport.scrollHeight > viewport.clientHeight && viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 4) current = anchors.at(-1)
      if (current) setActiveId(current.dataset.messageAnchor ?? "")
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }
    viewport.addEventListener("scroll", schedule, { passive: true })
    const observer = new ResizeObserver(schedule)
    observer.observe(viewport)
    const content = viewport.firstElementChild
    if (content) observer.observe(content)
    schedule()
    return () => { viewport.removeEventListener("scroll", schedule); observer.disconnect(); cancelAnimationFrame(frame) }
  }, [anchorKey, renderedStart, viewportRef])

  useEffect(() => {
    const nav = navRef.current
    const active = nav?.querySelector<HTMLElement>('[aria-current="location"]')
    if (!nav || !active) return
    const top = active.offsetTop
    if (top < nav.scrollTop || top + active.offsetHeight > nav.scrollTop + nav.clientHeight) {
      nav.scrollTop = top - nav.clientHeight / 2
    }
  }, [activeId])

  if (entries.length < 2) return null
  return (
    <nav ref={navRef} aria-label={t("messageNavigator")} className="scrollbar-none absolute left-1.5 top-1/2 z-20 hidden max-h-[65%] w-8 -translate-y-1/2 flex-col overflow-y-auto py-2 @min-[30rem]/thread:flex">
      {entries.map((entry) => <MessageMarker key={entry.id} entry={entry} active={entry.id === activeId} onNavigate={onNavigate} />)}
    </nav>
  )
}

function MessageMarker({ entry, active, onNavigate }: { entry: ThreadNavigationEntry; active: boolean; onNavigate: (entry: ThreadNavigationEntry) => void }) {
  const { t } = useTranslation("aiAssistant")
  const [open, setOpen] = useState(false)
  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={180} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label={t("jumpToMessage", { title: entry.title })}
          aria-current={active ? "location" : undefined}
          className="group/marker flex h-3 min-h-3 w-8 items-center rounded-sm px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onClick={() => { onNavigate(entry); setOpen(false) }}
        >
          <span className={cn("h-0.5 rounded-full transition-colors group-hover/marker:bg-foreground", active ? "bg-foreground" : "bg-muted-foreground/35")} style={{ width: active ? 24 : Math.min(22, 8 + entry.title.length / 5) }} />
        </button>
      </HoverCardTrigger>
      <HoverCardContent side="right" align="center" sideOffset={8} className="w-80 max-w-[calc(100vw-4rem)] space-y-2 rounded-xl p-3">
        <p className="line-clamp-2 break-words text-sm font-medium">{entry.title}</p>
        {entry.preview && <p className="line-clamp-4 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">{entry.preview}</p>}
      </HoverCardContent>
    </HoverCard>
  )
}
