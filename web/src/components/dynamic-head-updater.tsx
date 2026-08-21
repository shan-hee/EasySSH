
import { useEffect, useRef } from "react"
import { useSystemConfig } from "@/contexts/system-config-context"
import { DEFAULT_BRAND_ICON, DEFAULT_BRAND_NAME } from "@/lib/brand"

/**
 * 动态页面头部更新组件
 * 根据系统配置动态更新页面标题和favicon
 */
export function DynamicHeadUpdater() {
  const { config } = useSystemConfig()
  const faviconLinkRef = useRef<HTMLLinkElement | null>(null)

  useEffect(() => {
    if (!config) return

    // 更新页面标题
    document.title = config.system_name || DEFAULT_BRAND_NAME

    // 更新favicon
    const faviconUrl = config.system_favicon?.trim() || DEFAULT_BRAND_ICON
    // 查找或创建favicon link
    let faviconLink = faviconLinkRef.current

    if (!faviconLink) {
      // 尝试找到现有的favicon
      faviconLink = document.querySelector("link[rel*='icon']") as HTMLLinkElement

      if (!faviconLink) {
        // 如果不存在,创建新的
        faviconLink = document.createElement("link")
        faviconLink.rel = "icon"
        document.head.appendChild(faviconLink)
      }

      faviconLinkRef.current = faviconLink
    }

    // 更新href
    faviconLink.href = faviconUrl

    // 根据文件扩展名设置type
    const faviconPath = faviconUrl.split(/[?#]/, 1)[0]?.toLowerCase() ?? ""
    if (faviconPath.endsWith(".svg")) {
      faviconLink.type = "image/svg+xml"
    } else if (faviconPath.endsWith(".png")) {
      faviconLink.type = "image/png"
    } else if (faviconPath.endsWith(".ico")) {
      faviconLink.type = "image/x-icon"
    } else {
      faviconLink.removeAttribute("type")
    }
  }, [config])

  // 清理函数
  useEffect(() => {
    return () => {
      // 组件卸载时不删除favicon,因为它应该保留
      faviconLinkRef.current = null
    }
  }, [])

  return null // 这是一个效果组件,不渲染任何内容
}
