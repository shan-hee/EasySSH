
import * as React from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
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
}

const PageHeaderContext = React.createContext<PageHeaderTargets | null>(null)

export function PageHeaderHost({ children }: React.PropsWithChildren) {
  const { t: tNav } = useTranslation("nav")
  const [titleTarget, setTitleTarget] = React.useState<HTMLDivElement | null>(null)
  const [contentTarget, setContentTarget] = React.useState<HTMLDivElement | null>(null)
  const targets = React.useMemo(
    () => ({ title: titleTarget, content: contentTarget }),
    [contentTarget, titleTarget],
  )

  return (
    <PageHeaderContext.Provider value={targets}>
      <header className="z-30 flex h-16 shrink-0 items-center gap-2 bg-background/80 backdrop-blur transition-none supports-[backdrop-filter]:bg-background/60 group-data-[ready=true]/sidebar-wrapper:transition-[width,height] group-data-[ready=true]/sidebar-wrapper:duration-200 group-data-[ready=true]/sidebar-wrapper:ease-in-out group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
        <div className="flex min-w-0 flex-1 items-center gap-2 px-4">
          <SidebarTrigger
            className="-ml-1 md:hidden"
            aria-label={tNav("openSidebar")}
            title={tNav("openSidebar")}
          />
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
