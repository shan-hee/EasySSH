import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactNode,
} from "react"
import { useSidebar } from "@/components/ui/sidebar"

type AISidebarContextValue = {
  ready: boolean
  publishContent: (content: ReactNode) => void
  releaseContent: () => void
  clearInactiveContent: () => void
  registerTarget: () => () => void
  closeMobile: () => void
  reveal: () => void
}

const AISidebarContext = createContext<AISidebarContextValue | null>(null)
const AISidebarContentContext = createContext<ReactNode>(null)
const AISidebarNavigationContext = createContext<ReactNode>(null)

// Retain the outgoing panel until its slide completes, even when the route unmounts.
export function AISidebarHost({ children }: PropsWithChildren) {
  const [content, setContent] = useState<ReactNode>(null)
  const active = useRef(false)
  const targetMounted = useRef(false)
  const publishContent = useCallback((next: ReactNode) => {
    active.current = true
    setContent(next)
  }, [])
  const releaseContent = useCallback(() => {
    active.current = false
    if (!targetMounted.current) setContent(null)
  }, [])
  const clearInactiveContent = useCallback(() => {
    if (!active.current) setContent(null)
  }, [])
  const registerTarget = useCallback(() => {
    targetMounted.current = true
    return () => {
      targetMounted.current = false
      if (!active.current) setContent(null)
    }
  }, [])
  const { setOpenMobile, setOpen, isMobile } = useSidebar()
  const closeMobile = useCallback(() => setOpenMobile(false), [setOpenMobile])
  const reveal = useCallback(() => {
    if (isMobile) setOpenMobile(true)
    else setOpen(true)
  }, [isMobile, setOpen, setOpenMobile])
  const ready = content !== null
  const value = useMemo(
    () => ({
      ready,
      publishContent,
      releaseContent,
      clearInactiveContent,
      registerTarget,
      closeMobile,
      reveal,
    }),
    [
      ready,
      publishContent,
      releaseContent,
      clearInactiveContent,
      registerTarget,
      closeMobile,
      reveal,
    ],
  )
  return (
    <AISidebarContext.Provider value={value}>
      <AISidebarContentContext.Provider value={content}>
        {children}
      </AISidebarContentContext.Provider>
    </AISidebarContext.Provider>
  )
}

export function useAISidebarHost() {
  return useContext(AISidebarContext)
}

export function AISidebarContent({ children }: PropsWithChildren) {
  const host = useAISidebarHost()
  const publish = host?.publishContent
  const release = host?.releaseContent
  useLayoutEffect(() => {
    publish?.(children)
  }, [children, publish])
  useLayoutEffect(() => () => release?.(), [release])
  return null
}

export function useAISidebarNavigation() {
  return useContext(AISidebarNavigationContext)
}

export function AISidebarTarget({ navigation }: { navigation?: ReactNode }) {
  const content = useContext(AISidebarContentContext)
  const register = useAISidebarHost()?.registerTarget
  useLayoutEffect(() => register?.(), [register])
  return (
    <AISidebarNavigationContext.Provider value={navigation}>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{content}</div>
    </AISidebarNavigationContext.Provider>
  )
}
