import type { SessionTabDropSide } from "@/components/tabs/session-tab-bar"

export type SessionSplitOrientation = "horizontal" | "vertical"

export type SessionSplitLayoutNode =
  | { type: "leaf"; sessionId: string }
  | {
      type: "split"
      orientation: SessionSplitOrientation
      children: SessionSplitLayoutNode[]
      sizes?: number[]
    }

export const getSplitOrientation = (side: SessionTabDropSide): SessionSplitOrientation => (
  side === "left" || side === "right" ? "horizontal" : "vertical"
)

export const getSplitLayoutSessionIds = (node: SessionSplitLayoutNode | null): string[] => {
  if (!node) return []
  if (node.type === "leaf") return [node.sessionId]
  return node.children.flatMap(getSplitLayoutSessionIds)
}

export const ensureMultiSessionLayout = (layout: SessionSplitLayoutNode | null) => (
  getSplitLayoutSessionIds(layout).length > 1 ? layout : null
)

const normalizeSizes = (sizes: number[], count: number): number[] => {
  const fallback = Array.from({ length: count }, () => 1)
  const next = sizes.length === count
    ? sizes.map((size) => (Number.isFinite(size) && size > 0 ? size : 1))
    : fallback
  const total = next.reduce((sum, size) => sum + size, 0)
  return total > 0 ? next.map((size) => size / total) : fallback.map(() => 1 / count)
}

export const getSplitLayoutChildSizes = (node: SessionSplitLayoutNode): number[] => {
  if (node.type === "leaf") return []
  return normalizeSizes(node.sizes ?? [], node.children.length)
}

const normalizeSplitLayout = (node: SessionSplitLayoutNode | null): SessionSplitLayoutNode | null => {
  if (!node) return null
  if (node.type === "leaf") return node

  const normalizedChildren = node.children
    .map((child, index) => ({ child: normalizeSplitLayout(child), index }))
    .filter((item): item is { child: SessionSplitLayoutNode; index: number } => Boolean(item.child))
  const children = normalizedChildren.map((item) => item.child)

  if (children.length === 0) return null
  if (children.length === 1) return children[0]

  const sourceSizes = node.sizes ?? []
  const sizes = normalizeSizes(
    normalizedChildren.map((item) => sourceSizes[item.index] ?? 1),
    children.length
  )

  return { ...node, children, sizes }
}

export const filterSplitLayout = (
  node: SessionSplitLayoutNode | null,
  validSessionIds: Set<string>
): SessionSplitLayoutNode | null => {
  if (!node) return null
  if (node.type === "leaf") {
    return validSessionIds.has(node.sessionId) ? node : null
  }

  return normalizeSplitLayout({
    ...node,
    children: node.children
      .map((child) => filterSplitLayout(child, validSessionIds))
      .filter((child): child is SessionSplitLayoutNode => Boolean(child)),
  })
}

export const removeSessionFromSplitLayout = (
  node: SessionSplitLayoutNode | null,
  sessionId: string
): SessionSplitLayoutNode | null => {
  if (!node) return null
  if (node.type === "leaf") {
    return node.sessionId === sessionId ? null : node
  }

  return normalizeSplitLayout({
    ...node,
    children: node.children
      .map((child) => removeSessionFromSplitLayout(child, sessionId))
      .filter((child): child is SessionSplitLayoutNode => Boolean(child)),
  })
}

const containsSession = (node: SessionSplitLayoutNode, sessionId: string): boolean => (
  node.type === "leaf"
    ? node.sessionId === sessionId
    : node.children.some((child) => containsSession(child, sessionId))
)

const insertNearTarget = (
  node: SessionSplitLayoutNode,
  targetSessionId: string,
  sessionId: string,
  side: SessionTabDropSide
): { node: SessionSplitLayoutNode; inserted: boolean } => {
  const orientation = getSplitOrientation(side)
  const insertBefore = side === "left" || side === "top"
  const newLeaf: SessionSplitLayoutNode = { type: "leaf", sessionId }

  if (node.type === "leaf") {
    if (node.sessionId !== targetSessionId) {
      return { node, inserted: false }
    }

    return {
      node: {
        type: "split",
        orientation,
        children: insertBefore ? [newLeaf, node] : [node, newLeaf],
        sizes: [0.5, 0.5],
      },
      inserted: true,
    }
  }

  const targetChildIndex = node.children.findIndex((child) => containsSession(child, targetSessionId))
  if (targetChildIndex === -1) {
    return { node, inserted: false }
  }

  if (node.orientation === orientation) {
    const children = [...node.children]
    const sizes = getSplitLayoutChildSizes(node)
    const targetSize = sizes[targetChildIndex] ?? 1 / node.children.length
    const insertIndex = insertBefore ? targetChildIndex : targetChildIndex + 1
    sizes[targetChildIndex] = targetSize / 2
    sizes.splice(insertIndex, 0, targetSize / 2)
    children.splice(insertIndex, 0, newLeaf)
    return {
      node: normalizeSplitLayout({ ...node, children, sizes }) ?? node,
      inserted: true,
    }
  }

  const nested = insertNearTarget(node.children[targetChildIndex], targetSessionId, sessionId, side)
  if (!nested.inserted) {
    return { node, inserted: false }
  }

  const children = [...node.children]
  children[targetChildIndex] = nested.node
  return {
    node: normalizeSplitLayout({ ...node, children, sizes: node.sizes }) ?? node,
    inserted: true,
  }
}

export const updateSplitLayoutSizes = (
  node: SessionSplitLayoutNode | null,
  path: number[],
  sizes: number[]
): SessionSplitLayoutNode | null => {
  if (!node || node.type === "leaf") return node

  if (path.length === 0) {
    return normalizeSplitLayout({
      ...node,
      sizes: normalizeSizes(sizes, node.children.length),
    })
  }

  const [childIndex, ...nextPath] = path
  if (childIndex < 0 || childIndex >= node.children.length) return node

  const children = [...node.children]
  children[childIndex] = updateSplitLayoutSizes(children[childIndex], nextPath, sizes) ?? children[childIndex]
  return normalizeSplitLayout({ ...node, children, sizes: node.sizes })
}

export const addSessionToSplitLayout = ({
  layout,
  sessionId,
  targetSessionId,
  side,
  fallbackSessionIds,
}: {
  layout: SessionSplitLayoutNode | null
  sessionId: string
  targetSessionId: string | null
  side: SessionTabDropSide
  fallbackSessionIds: string[]
}): SessionSplitLayoutNode | null => {
  const cleanedLayout = removeSessionFromSplitLayout(layout, sessionId)
  const existingIds = getSplitLayoutSessionIds(cleanedLayout)
  const targetId = targetSessionId && targetSessionId !== sessionId
    ? targetSessionId
    : existingIds.find((id) => id !== sessionId)
      ?? fallbackSessionIds.find((id) => id !== sessionId)
      ?? null

  if (!targetId) return cleanedLayout

  const baseLayout = cleanedLayout && existingIds.includes(targetId)
    ? cleanedLayout
    : { type: "leaf", sessionId: targetId } satisfies SessionSplitLayoutNode

  const inserted = insertNearTarget(baseLayout, targetId, sessionId, side)
  const nextLayout = inserted.inserted ? inserted.node : baseLayout
  return getSplitLayoutSessionIds(nextLayout).length > 1 ? nextLayout : null
}
