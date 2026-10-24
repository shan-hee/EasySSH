import { useRevalidator, useRouteError } from "react-router-dom"

// 错误恢复入口自身不依赖懒加载模块或翻译文件。
export function RouteErrorBoundary() {
  const error = useRouteError()
  const revalidator = useRevalidator()
  const english = document.documentElement.lang === "en-US"
  return (
    <div role="alert" className="flex min-h-64 flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <p>{english ? "Something went wrong while displaying this page. Please try again." : "页面显示时发生错误，请重试。"}</p>
      {import.meta.env.DEV && error instanceof Error && <p className="text-sm text-muted-foreground">{error.message}</p>}
      <div className="flex gap-3">
        <button className="rounded-md border px-4 py-2" disabled={revalidator.state !== "idle"} onClick={() => void revalidator.revalidate()}>
          {english ? "Try again" : "重试"}
        </button>
        <button className="rounded-md border px-4 py-2" onClick={() => window.location.reload()}>
          {english ? "Reload page" : "重新加载页面"}
        </button>
      </div>
    </div>
  )
}
