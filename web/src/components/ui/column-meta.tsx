import type { ColumnDef } from "@tanstack/react-table"
import * as React from "react"
import { cn } from "@/lib/utils"

export type ColumnAlign = "left" | "center" | "right"
export type ColumnSticky = "left" | "right"

export interface DataTableColumnMeta {
  align?: ColumnAlign
  sticky?: ColumnSticky
  headerClassName?: string
  cellClassName?: string
}

export function getColumnMeta<TData, TValue>(
  columnDef: ColumnDef<TData, TValue>
): DataTableColumnMeta {
  return (columnDef.meta ?? {}) as DataTableColumnMeta
}

export function resolveAlignClass(align: ColumnAlign | undefined): string {
  // text-align 对 inline/普通流内容生效；cell 内的 flex 容器需自行用
  // justify-* 配合，但方向应与 meta.align 保持一致。
  if (align === "center") return "text-center"
  if (align === "right") return "text-right"
  return "text-left"
}

export function resolveStickyClass(
  sticky: ColumnSticky | undefined,
  position: "head" | "cell"
): string {
  if (!sticky) return ""
  // sticky 列需配合 box-shadow 边线，避免滚动时和后续列重叠
  const side = sticky === "left" ? "left-0" : "right-0"
  const shadow =
    sticky === "left"
      ? "shadow-[2px_0_0_0_var(--table-sticky-shadow,transparent)]"
      : "shadow-[-2px_0_0_0_var(--table-sticky-shadow,transparent)]"
  return cn(
    "sticky z-[2] bg-inherit",
    side,
    shadow,
    position === "head" && "bg-table-header"
  )
}

export function resolveColumnClass<TData, TValue>(
  columnDef: ColumnDef<TData, TValue>,
  position: "head" | "cell"
): string {
  const meta = getColumnMeta(columnDef)
  const extra = position === "head" ? meta.headerClassName : meta.cellClassName
  return cn(
    resolveAlignClass(meta.align),
    resolveStickyClass(meta.sticky, position),
    extra
  )
}

/**
 * Cell 内部对齐包装：从 column meta 读取 align，对 flex 容器应用 justify-*。
 * td 自身的 text-align 已通过 resolveColumnClass 处理 inline 内容；
 * 当 cell 内是 flex 布局时，用本组件包装以保持与 meta 一致。
 */
export function CellAlign({
  align,
  className,
  children,
}: {
  align: ColumnAlign | undefined
  className?: string
  children: React.ReactNode
}) {
  const justify =
    align === "center"
      ? "justify-center"
      : align === "right"
        ? "justify-end"
        : "justify-start"
  return (
    <div className={cn("flex w-full min-w-0 items-center", justify, className)}>
      {children}
    </div>
  )
}
