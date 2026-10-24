import { useEffect } from "react"
import { useReducedMotion } from "motion/react"
import NProgress from "nprogress"
import { useNavigation } from "react-router-dom"
import { useTranslation } from "react-i18next"
import "@/styles/navigation-progress.css"

/** 只绑定路由状态；进度推进、完成和淡出均由 NProgress 管理。 */
export function NavigationProgress() {
  const { state } = useNavigation()
  const pending = state !== "idle"
  const reducedMotion = useReducedMotion()
  const { t } = useTranslation("common", { useSuspense: false })

  useEffect(() => {
    NProgress.configure({
      showSpinner: false,
      speed: reducedMotion ? 0 : 200,
      trickle: !reducedMotion,
      // NProgress 的 role="bar" 用于内部查找；辅助技术通过下方状态文本获取反馈。
      template: '<div class="bar" role="bar" aria-hidden="true"><div class="peg"></div></div>',
    })
  }, [reducedMotion])

  useEffect(() => {
    if (!pending) {
      NProgress.done()
      return
    }
    // 快速导航不闪现进度条；导航被取消时同时取消尚未触发的 start。
    const timer = window.setTimeout(() => NProgress.start(), 150)
    return () => window.clearTimeout(timer)
  }, [pending])

  useEffect(() => () => {
    NProgress.done()
    NProgress.remove()
  }, [])

  return <span role="status" className="sr-only">{pending ? t("loading") : ""}</span>
}
