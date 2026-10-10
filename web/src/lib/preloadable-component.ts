import { createElement, type ComponentType } from "react"
import { createRetryableLoader } from "./retryable-loader"

// 预加载和渲染共用已完成的结果，避免 React.lazy 首次渲染仍然触发 Suspense。
export function createPreloadableComponent<Props extends object>(
  loader: () => Promise<{ default: ComponentType<Props> }>,
) {
  const resource = createRetryableLoader(loader)

  function Component(props: Props) {
    return createElement(resource.read().default, props)
  }

  async function preload() {
    resource.reset()
    await resource.load()
    resource.read()
  }

  return { Component, preload }
}
