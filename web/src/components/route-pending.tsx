import { PageLoading } from "@/components/page-loading"

/** 桌面视图和页面内懒加载的占位；Web 导航由 Data Router 保留旧页面。 */
export function RoutePending() {
  return <PageLoading className="min-h-0 w-full" />
}
