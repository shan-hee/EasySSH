import { Fragment, type ReactNode, useRef } from "react"
import { cn } from "@/lib/utils"
import {
  getSplitLayoutChildSizes,
  getSplitLayoutSessionIds,
  type SessionSplitLayoutNode,
} from "@/lib/session/split-layout"
import { SessionSplitResizer } from "@/components/tabs/session-split-resizer"

interface SessionSplitViewProps {
  node: SessionSplitLayoutNode
  renderLeaf: (sessionId: string) => ReactNode
  onResize: (path: number[], sizes: number[]) => void
  hiddenSessionId?: string | null
  path?: number[]
}

export function SessionSplitView({
  node,
  renderLeaf,
  onResize,
  hiddenSessionId = null,
  path = [],
}: SessionSplitViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  if (node.type === "leaf") {
    return renderLeaf(node.sessionId)
  }

  const sizes = getSplitLayoutChildSizes(node)
  const isChildHidden = (child: SessionSplitLayoutNode) => (
    hiddenSessionId
      ? getSplitLayoutSessionIds(child).every((sessionId) => sessionId === hiddenSessionId)
      : false
  )
  const hiddenIndexes = new Set(
    node.children
      .map((child, index) => (isChildHidden(child) ? index : -1))
      .filter((index) => index >= 0)
  )
  const visibleSizeTotal = sizes.reduce((total, size, index) => (
    hiddenIndexes.has(index) ? total : total + size
  ), 0)
  const getVisibleFlexSize = (index: number) => {
    if (visibleSizeTotal <= 0) return 1
    return (sizes[index] ?? 1) / visibleSizeTotal
  }

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative flex min-h-0 min-w-0 flex-1",
        node.orientation === "horizontal" ? "flex-row" : "flex-col"
      )}
    >
      {node.children.map((child, index) => {
        const childHidden = isChildHidden(child)
        const previousChildHidden = index > 0 ? isChildHidden(node.children[index - 1]) : false

        return (
          <Fragment key={index}>
            {index > 0 && !childHidden && !previousChildHidden && (
              <SessionSplitResizer
                orientation={node.orientation}
                sizes={sizes}
                index={index - 1}
                containerRef={containerRef}
                onResize={(nextSizes) => onResize(path, nextSizes)}
              />
            )}
            <div
              aria-hidden={childHidden || undefined}
              className={cn(
                "flex min-h-0 min-w-0",
                childHidden && "pointer-events-none absolute inset-0 z-0 overflow-hidden opacity-0"
              )}
              style={childHidden
                ? undefined
                : {
                    flex: `${getVisibleFlexSize(index)} ${getVisibleFlexSize(index)} 0`,
                  }}
            >
              <SessionSplitView
                node={child}
                renderLeaf={renderLeaf}
                onResize={onResize}
                hiddenSessionId={hiddenSessionId}
                path={[...path, index]}
              />
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}
