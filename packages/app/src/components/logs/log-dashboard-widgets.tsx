import type { LucideIcon } from "lucide-react"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export type DashboardTone = "emerald" | "blue" | "violet" | "amber" | "rose" | "cyan" | "slate"

const TONE_STYLES: Record<
  DashboardTone,
  {
    icon: string
    spark: string
    soft: string
  }
> = {
  emerald: {
    icon: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    spark: "text-emerald-500",
    soft: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  blue: {
    icon: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    spark: "text-blue-500",
    soft: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  violet: {
    icon: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    spark: "text-violet-500",
    soft: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
  amber: {
    icon: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    spark: "text-amber-500",
    soft: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  rose: {
    icon: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
    spark: "text-rose-500",
    soft: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
  cyan: {
    icon: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
    spark: "text-cyan-500",
    soft: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  },
  slate: {
    icon: "bg-muted text-muted-foreground",
    spark: "text-muted-foreground",
    soft: "bg-muted text-muted-foreground",
  },
}

function buildSparkPath(data: number[], width: number, height: number) {
  if (data.length === 0) return ""
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1
  const step = data.length > 1 ? width / (data.length - 1) : width

  return data
    .map((value, index) => {
      const x = index * step
      const y = height - ((value - min) / range) * (height - 4) - 2
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(" ")
}

export function DashboardMetricCard({
  title,
  value,
  icon: Icon,
  tone = "blue",
  spark = [],
  loading,
}: {
  title: string
  value: string | number
  icon: LucideIcon
  tone?: DashboardTone
  spark?: number[]
  loading?: boolean
}) {
  const toneStyle = TONE_STYLES[tone]
  const linePath = buildSparkPath(spark, 96, 30)

  return (
    <Card className="gap-0 p-5 transition-shadow hover:shadow-md">
      {loading ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 animate-pulse rounded-lg bg-primary/10" />
            <div className="space-y-2">
              <div className="h-3 w-20 animate-pulse rounded bg-primary/10" />
              <div className="h-7 w-16 animate-pulse rounded bg-primary/10" />
            </div>
          </div>
          <div className="h-8 w-full animate-pulse rounded bg-primary/10" />
        </div>
      ) : (
        <>
          <div className="flex items-start gap-3">
            <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-lg", toneStyle.icon)}>
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm text-muted-foreground">{title}</p>
              <p className="text-2xl font-bold leading-tight tabular-nums">{value}</p>
            </div>
          </div>
          {/* 固定高度，加载前后与有无走势数据时卡片高度一致 */}
          <div className="mt-4 flex h-8 items-end justify-end">
            {linePath && (
              <svg viewBox="0 0 96 30" className={cn("h-8 w-24", toneStyle.spark)} aria-hidden="true">
                <path d={linePath} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            )}
          </div>
        </>
      )}
    </Card>
  )
}

export function InlineStatusBadge({
  label,
  tone = "slate",
}: {
  label: string
  tone?: DashboardTone
}) {
  return (
    <span className={cn("inline-flex max-w-full items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium", TONE_STYLES[tone].soft)} title={label}>
      <span className="truncate">{label}</span>
    </span>
  )
}
