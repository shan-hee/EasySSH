import { useLayoutEffect, type RefObject } from "react"

export function scrollSelectedItemIntoNearestView(
  containerElement: HTMLElement,
  selectedElement: HTMLElement,
) {
  const containerRect = containerElement.getBoundingClientRect()
  const selectedRect = selectedElement.getBoundingClientRect()
  const selectedTop = selectedRect.top - containerRect.top - containerElement.clientTop + containerElement.scrollTop
  const selectedBottom = selectedTop + selectedRect.height
  const visibleTop = containerElement.scrollTop
  const visibleBottom = visibleTop + containerElement.clientHeight

  if (selectedTop < visibleTop) {
    containerElement.scrollTop = selectedTop
    return
  }

  if (selectedBottom > visibleBottom) {
    containerElement.scrollTop = selectedBottom - containerElement.clientHeight
  }
}

export function useSynchronousSelectedItemScroll<TListElement extends HTMLElement>({
  enabled = true,
  listRef,
  selectedKey,
}: {
  enabled?: boolean
  listRef: RefObject<TListElement | null>
  selectedKey: unknown
}) {
  useLayoutEffect(() => {
    if (!enabled) {
      return
    }

    const listElement = listRef.current
    if (!listElement) {
      return
    }

    const selectedElement = listElement.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')
    if (!selectedElement) return

    // Sync before paint: once selection reaches an edge, move the contents by
    // the overflow distance, keeping the highlight at that edge. Only touch
    // this viewport; never scroll the page or update the selection on scroll.
    scrollSelectedItemIntoNearestView(listElement, selectedElement)
  }, [enabled, listRef, selectedKey])
}
