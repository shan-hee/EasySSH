import { useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"

/** 工作台（终端与文件）所在视图的标识。 */
export const WORKBENCH_VIEW = "workbench"

export interface WorkspaceView {
  id: string
  content: ReactNode
  /** 首次进入后保持挂载以保留状态；为 false 时离开即卸载。默认 true。 */
  keepAlive?: boolean
  className?: string
}

export interface WorkspaceShellProps {
  /** 当前视图；`WORKBENCH_VIEW` 表示工作台。 */
  activeView: string
  workbench: ReactNode
  views: readonly WorkspaceView[]
  /** 完整视图的顶部栏（返回工作台、标题与操作）；工作台使用自身的标签栏。 */
  viewHeader?: ReactNode
  className?: string
}

const sectionClassName = "pointer-events-none invisible absolute inset-0 flex min-h-0 min-w-0 overflow-hidden opacity-0 data-[active=true]:pointer-events-auto data-[active=true]:visible data-[active=true]:opacity-100"

/**
 * 工作区外壳：工作台始终挂载，切换到完整视图不会重建连接或中断传输；
 * 进入过的完整视图默认保留状态，返回时无需重新加载。
 */
export function WorkspaceShell({ activeView, workbench, views, viewHeader, className }: WorkspaceShellProps) {
  const [visitedViews, setVisitedViews] = useState<ReadonlySet<string>>(() => new Set([activeView]))
  if (!visitedViews.has(activeView)) {
    setVisitedViews(new Set(visitedViews).add(activeView))
  }

  const workbenchActive = activeView === WORKBENCH_VIEW

  return (
    <main className={cn("flex h-full w-full min-h-0 min-w-0 isolate flex-col overflow-hidden bg-background text-foreground", className)}>
      {!workbenchActive && viewHeader}
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        <section
          className={sectionClassName}
          data-active={workbenchActive}
          aria-hidden={!workbenchActive}
          inert={!workbenchActive}
        >
          {workbench}
        </section>
        {views.map((view) => {
          const active = view.id === activeView
          const mounted = active || (view.keepAlive !== false && visitedViews.has(view.id))
          if (!mounted) return null

          return (
            <section
              key={view.id}
              className={cn(sectionClassName, view.className)}
              data-active={active}
              aria-hidden={!active}
              inert={!active}
            >
              {view.content}
            </section>
          )
        })}
      </div>
    </main>
  )
}
