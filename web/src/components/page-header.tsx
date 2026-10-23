
import * as React from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import { useLocation } from "react-router-dom"
import { DashboardHeaderActions } from "@/components/dashboard-header-actions"
import { SidebarTrigger } from "@/components/ui/sidebar"

interface PageHeaderProps {
  title: string
  titleActions?: React.ReactNode
  children?: React.ReactNode
}

interface PageHeaderTargets {
  title: HTMLDivElement | null
  content: HTMLDivElement | null
  registerTitle: () => () => void
}

const PageHeaderContext = React.createContext<PageHeaderTargets | null>(null)

const routeTitles = [
  { path: "/dashboard/settings/management", navKey: "userManagement", namespace: "settingsManagement", key: "pageTitle" },
  { path: "/dashboard/ai-assistant", navKey: "aiAssistant", namespace: "nav", key: "aiAssistant" },
  { path: "/dashboard/terminal", navKey: "terminal", namespace: "nav", key: "terminal" },
  { path: "/dashboard/users", navKey: "userManagement", namespace: "users", key: "pageTitle" },
  { path: "/dashboard/logs", navKey: "logs", namespace: "logsAudit", key: "logsPageTitle" },
  { path: "/dashboard/operation-logs", navKey: "operationLogs", namespace: "operationLogs", key: "pageTitle" },
  { path: "/dashboard/scripts", navKey: "scripts", namespace: "scripts", key: "pageTitle" },
  { path: "/dashboard/tasks", navKey: "tasks", namespace: "taskCenter", key: "title" },
  { path: "/dashboard/settings", navKey: "systemSettings", namespace: "settingsMain", key: "pageTitle" },
  { path: "/dashboard/error", navKey: "console", namespace: "errors", key: "defaultTitle" },
  { path: "/dashboard", navKey: "console", namespace: "dashboard", key: "title", exact: true },
] as const

export function PageHeaderHost({ children }: React.PropsWithChildren) {
  const { pathname } = useLocation()
  const route = routeTitles.find((item) => (
    "exact" in item && item.exact
      ? pathname === item.path
      : pathname === item.path || pathname.startsWith(`${item.path}/`)
  ))
  const { t: tNav } = useTranslation("nav")
  const { t, ready } = useTranslation(route?.namespace ?? "nav", { useSuspense: false })
  const [titleTarget, setTitleTarget] = React.useState<HTMLDivElement | null>(null)
  const [contentTarget, setContentTarget] = React.useState<HTMLDivElement | null>(null)
  const [hasPageTitle, setHasPageTitle] = React.useState(false)
  const titleRegistrations = React.useRef(0)
  const registerTitle = React.useCallback(() => {
    titleRegistrations.current += 1
    setHasPageTitle(true)

    return () => {
      titleRegistrations.current = Math.max(0, titleRegistrations.current - 1)
      setHasPageTitle(titleRegistrations.current > 0)
    }
  }, [])
  const routeTitle = route ? (ready ? t(route.key) : tNav(route.navKey)) : ""
  const targets = React.useMemo(
    () => ({ title: titleTarget, content: contentTarget, registerTitle }),
    [contentTarget, registerTitle, titleTarget],
  )

  return (
    <PageHeaderContext.Provider value={targets}>
      <header data-slot="page-header" className="z-30 flex h-16 shrink-0 items-center gap-2 bg-transparent transition-none group-data-[ready=true]/sidebar-wrapper:transition-[height] group-data-[ready=true]/sidebar-wrapper:duration-200 group-data-[ready=true]/sidebar-wrapper:ease-in-out group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
        <div className="flex min-w-0 flex-1 items-center gap-2 px-4">
          <SidebarTrigger
            className="-ml-1 md:hidden"
            aria-label={tNav("openSidebar")}
            title={tNav("openSidebar")}
          />
          {!hasPageTitle && routeTitle ? (
            <h1 className="truncate text-sm font-semibold text-foreground md:text-base">
              {routeTitle}
            </h1>
          ) : null}
          <div ref={setTitleTarget} className="contents" />
        </div>
        <div className="flex min-w-0 max-w-[72vw] items-center justify-end gap-2 px-4 md:max-w-none">
          <div ref={setContentTarget} className="contents" />
          <DashboardHeaderActions />
        </div>
      </header>
      {children}
    </PageHeaderContext.Provider>
  )
}

export function PageHeader({ title, titleActions, children }: PageHeaderProps) {
  const targets = React.useContext(PageHeaderContext)
  const registerTitle = targets?.registerTitle

  React.useLayoutEffect(() => registerTitle?.(), [registerTitle])

  if (!targets) {
    throw new Error("PageHeader must be rendered inside PageHeaderHost")
  }

  return (
    <>
      {targets.title
        ? createPortal(
            <>
              <h1 className="truncate text-sm font-semibold text-foreground md:text-base">
                {title}
              </h1>
              {titleActions ? (
                <div className="flex shrink-0 items-center gap-1">
                  {titleActions}
                </div>
              ) : null}
            </>,
            targets.title,
          )
        : null}
      {targets.content && children
        ? createPortal(
            <div className="flex min-w-0 items-center gap-2 overflow-x-auto scrollbar-none">
              {children}
            </div>,
            targets.content,
          )
        : null}
    </>
  )
}
