import { useLayoutEffect, type RefObject } from "react"

export function scrollSelectedItemIntoNearestView(
  containerElement: HTMLElement,
  selectedElement: HTMLElement,
) {
  const containerRect = containerElement.getBoundingClientRect()
  const selectedRect = selectedElement.getBoundingClientRect()
  const selectedTop = selectedRect.top - containerRect.top + containerElement.scrollTop
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
  getSelectedElement,
  listRef,
  selectedKey,
}: {
  enabled?: boolean
  getSelectedElement: () => HTMLElement | null | undefined
  listRef: RefObject<TListElement | null>
  selectedKey: unknown
}) {
  useLayoutEffect(() => {
    if (!enabled) {
      return
    }

    const listElement = listRef.current
    const selectedElement = getSelectedElement()

    if (!listElement || !selectedElement) {
      return
    }

    scrollSelectedItemIntoNearestView(listElement, selectedElement)
  }, [enabled, getSelectedElement, listRef, selectedKey])
}
