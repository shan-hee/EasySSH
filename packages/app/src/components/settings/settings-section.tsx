
import * as React from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface SettingsSectionProps {
  title: string
  description?: string
  children: React.ReactNode
  icon?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}

/**
 * 设置区块组件
 * 用于包裹设置表单的标准卡片布局
 */
export function SettingsSection({
  title,
  description,
  children,
  icon,
  actions,
  className,
}: SettingsSectionProps) {
  return (
    <Card className={cn("border-none shadow-none bg-transparent py-0 gap-0", className)}>
      <CardHeader className="p-0 pb-4 border-none">
        <div className="flex min-h-8 flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 pt-1">
            {icon}
            <CardTitle className="border-none">{title}</CardTitle>
          </div>
          {actions && <div className="shrink-0 empty:hidden">{actions}</div>}
        </div>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="p-0 space-y-4 border-none">
        {children}
      </CardContent>
    </Card>
  )
}
