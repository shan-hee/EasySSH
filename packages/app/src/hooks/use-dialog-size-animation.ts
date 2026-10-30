import { useCallback, type Ref } from "react"
import { animate } from "motion/mini"
import { useReducedMotion } from "motion/react"

import { motionTransitions } from "@/lib/motion"

function measureScrollContainers(element: HTMLElement) {
  const containers = new Map<HTMLElement, { x: boolean | null; y: boolean | null }>()
  for (const node of [element, ...element.querySelectorAll<HTMLElement>("*")]) {
    const style = getComputedStyle(node)
    const canScrollX = style.overflowX === "auto" || style.overflowX === "scroll"
    const canScrollY = style.overflowY === "auto" || style.overflowY === "scroll"
    if (canScrollX || canScrollY) {
      containers.set(node, {
        x: canScrollX ? node.scrollWidth > node.clientWidth : null,
        y: canScrollY ? node.scrollHeight > node.clientHeight : null,
      })
    }
  }
  return containers
}

/** 动画作用于实际宽高，覆盖子组件更新、图片加载引起的尺寸变化。 */
export function useDialogSizeAnimation(ref?: Ref<HTMLDivElement>) {
  const reduceMotion = useReducedMotion()

  return useCallback((element: HTMLDivElement | null) => {
    const releaseRef = typeof ref === "function" ? ref(element) : undefined
    if (ref && typeof ref !== "function") ref.current = element
    if (!element) return

    let previous = element.getBoundingClientRect()
    let previousScrollContainers = measureScrollContainers(element)
    let stopAnimation: (() => void) | undefined

    const observer = new ResizeObserver(() => {
      // 只比较自然尺寸，动画期间暂停监听，避免宽高动画触发观察器循环。
      if (stopAnimation) return
      const next = element.getBoundingClientRect()
      const before = previous
      previous = next
      // 在锁定动画宽高之前，按自然布局判断是否真正达到滚动阈值。
      const scrollContainers = measureScrollContainers(element)
      const beforeScrollContainers = previousScrollContainers
      previousScrollContainers = scrollContainers
      if (
        reduceMotion || element.dataset.state !== "open" ||
        !before.width || !before.height || !next.width || !next.height
      ) return

      const keyframes: Record<string, string[]> = {}
      if (Math.abs(before.width - next.width) > 1) {
        keyframes.width = [`${before.width}px`, `${next.width}px`]
        keyframes.minWidth = keyframes.width
        keyframes.maxWidth = keyframes.width
      }
      if (Math.abs(before.height - next.height) > 1) {
        keyframes.height = [`${before.height}px`, `${next.height}px`]
        keyframes.minHeight = keyframes.height
        keyframes.maxHeight = keyframes.height
      }
      if (!Object.keys(keyframes).length) return

      // 内容按最终状态排版时，避免新内容溢出尚未展开的外壳。
      if (getComputedStyle(element).overflow === "visible") {
        keyframes.overflow = ["hidden", "hidden"]
      }

      const original = Object.keys(keyframes).map((key) => {
        const property = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
        return {
          property,
          value: element.style.getPropertyValue(property),
          priority: element.style.getPropertyPriority(property),
        }
      })
      observer.disconnect()
      const suppressedOverflow: {
        node: HTMLElement
        property: string
        value: string
        priority: string
      }[] = []
      for (const [node, scrolling] of scrollContainers) {
        for (const axis of ["x", "y"] as const) {
          const dimension = axis === "x" ? "width" : "height"
          if (!keyframes[dimension] || scrolling[axis] === null) continue
          const expanding = next[dimension] > before[dimension]
          // 已经存在的滚动条保留，滑块随每一帧的可用空间由浏览器计算。
          // 新滚动条等展开至目标尺寸后再交给 overflow:auto 判断；
          // 最终能容纳的内容则全程不因动画中间尺寸而闪出滚动条。
          if (scrolling[axis] && (!expanding || beforeScrollContainers.get(node)?.[axis])) continue
          const property = `overflow-${axis}`
          suppressedOverflow.push({
            node,
            property,
            value: node.style.getPropertyValue(property),
            priority: node.style.getPropertyPriority(property),
          })
        }
      }
      for (const { node, property } of suppressedOverflow) {
        node.style.setProperty(property, "hidden")
      }
      const animation = animate(element, keyframes, motionTransitions.layout)
      const stop = () => {
        animation.cancel()
        for (const { property, value, priority } of original) {
          if (value) element.style.setProperty(property, value, priority)
          else element.style.removeProperty(property)
        }
        for (const { node, property, value, priority } of suppressedOverflow) {
          if (value) node.style.setProperty(property, value, priority)
          else node.style.removeProperty(property)
        }
        stopAnimation = undefined
        observer.observe(element, { box: "border-box" })
      }
      stopAnimation = stop
      void animation.then(() => {
        if (stopAnimation === stop) stop()
        // 恢复 CSS 自适应后重新测量，接续动画期间发生的内容变化。
      })
    })

    observer.observe(element, { box: "border-box" })
    const onResize = () => {
      stopAnimation?.()
      previous = element.getBoundingClientRect()
    }
    window.addEventListener("resize", onResize)

    return () => {
      window.removeEventListener("resize", onResize)
      stopAnimation?.()
      observer.disconnect()
      if (typeof releaseRef === "function") releaseRef()
      else if (typeof ref === "function") ref(null)
      else if (ref) ref.current = null
    }
  }, [ref, reduceMotion])
}
