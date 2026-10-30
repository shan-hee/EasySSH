import { Component, type ReactNode } from "react"
import { getResourceError, subscribeResourceErrors } from "@/lib/resource-errors"

interface Props {
  children: ReactNode
  onRetry?: () => void
  listenForResourceErrors?: boolean
  renderError?: (recovery: ReactNode) => ReactNode
}

// 不依赖翻译包或异步组件，网络资源加载失败时仍能展示恢复入口。
export class ResourceBoundary extends Component<Props, { error: unknown; resourceError: Error | null }> {
  state: { error: unknown; resourceError: Error | null } = {
    error: null,
    resourceError: this.props.listenForResourceErrors ? getResourceError() : null,
  }
  private unsubscribe?: () => void

  static getDerivedStateFromError(error: unknown) {
    return { error }
  }

  componentDidMount() {
    if (this.props.listenForResourceErrors) {
      this.unsubscribe = subscribeResourceErrors(() => this.setState({ resourceError: getResourceError() }))
      if (getResourceError()) this.setState({ resourceError: getResourceError() })
    }
  }

  componentWillUnmount() {
    this.unsubscribe?.()
  }

  render() {
    if (!this.state.error && !this.state.resourceError) return <>{this.props.children}</>
    const english = document.documentElement.lang === "en-US"
    const recovery = (
      <div role="alert" className="flex min-h-48 flex-col items-center justify-center gap-4 p-6 text-center">
        <p>{english ? "Unable to load this content. Check your connection and try again." : "内容加载失败，请检查网络后重试。"}</p>
        <div className="flex gap-3">
          {this.props.onRetry && (
            <button className="rounded-md border px-4 py-2" onClick={() => {
              this.props.onRetry?.()
              this.setState({ error: null })
            }}>{english ? "Try again" : "重试"}</button>
          )}
          <button className="rounded-md border px-4 py-2" onClick={() => window.location.reload()}>
            {english ? "Reload page" : "重新加载页面"}
          </button>
        </div>
      </div>
    )
    if (this.state.error) return this.props.renderError?.(recovery) ?? recovery
    // 文案下载失败时保留已经挂载的终端，避免断开正在使用的会话。
    return <>{this.props.children}<div className="fixed inset-0 z-[100] flex items-center justify-center bg-background">{recovery}</div></>
  }
}
