import { Suspense, type ReactNode } from "react"
import { ResourceBoundary } from "@easyssh/app/components/resource-boundary"
import { RoutePending } from "@easyssh/app/components/route-pending"
import { desktopViews, type DesktopContentView } from "./desktop-view-registry"

export function DesktopViewBoundary({ view, children }: { view: DesktopContentView; children: ReactNode }) {
  return (
    <ResourceBoundary onRetry={desktopViews[view].reset}>
      <Suspense fallback={<RoutePending />}>{children}</Suspense>
    </ResourceBoundary>
  )
}
