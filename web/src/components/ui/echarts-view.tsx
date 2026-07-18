import * as React from "react"
import * as echarts from "echarts"
import type { ECharts, EChartsOption, SetOptionOpts } from "echarts"

import { cn } from "@/lib/utils"

export interface EChartsViewHandle {
  getInstance: () => ECharts | null
}

interface EChartsViewProps extends Omit<React.ComponentProps<"div">, "children"> {
  option: EChartsOption
  notMerge?: boolean
  lazyUpdate?: boolean
}

/**
 * 由项目直接管理生命周期的 ECharts 容器。
 *
 * 实例与 ResizeObserver 在同一个 effect 中创建和销毁，确保 React StrictMode
 * 的重复挂载以及快速切换页面时不会留下图表实例或尺寸监听器。
 */
export const EChartsView = React.forwardRef<EChartsViewHandle, EChartsViewProps>(
  ({ className, option, notMerge = false, lazyUpdate = false, ...props }, ref) => {
    const containerRef = React.useRef<HTMLDivElement | null>(null)
    const chartRef = React.useRef<ECharts | null>(null)
    const optionRef = React.useRef(option)
    const setOptionOptionsRef = React.useRef<SetOptionOpts>({ notMerge, lazyUpdate })

    optionRef.current = option
    setOptionOptionsRef.current = { notMerge, lazyUpdate }

    React.useImperativeHandle(ref, () => ({
      getInstance: () => chartRef.current,
    }), [])

    React.useLayoutEffect(() => {
      const container = containerRef.current
      if (!container) return

      let chart: ECharts | null = null
      let resizeFrame: number | null = null
      const syncChartSize = () => {
        if (resizeFrame !== null) {
          cancelAnimationFrame(resizeFrame)
        }
        resizeFrame = requestAnimationFrame(() => {
          resizeFrame = null
          const { width, height } = container.getBoundingClientRect()
          if (width <= 1 || height <= 1) return

          if (!chart || chart.isDisposed()) {
            chart = echarts.getInstanceByDom(container) ?? echarts.init(container)
            chartRef.current = chart
            chart.setOption(optionRef.current, setOptionOptionsRef.current)
          }
          chart.resize({ width, height })
        })
      }

      const resizeObserver = new ResizeObserver(syncChartSize)
      resizeObserver.observe(container)
      syncChartSize()

      return () => {
        resizeObserver.disconnect()
        if (resizeFrame !== null) {
          cancelAnimationFrame(resizeFrame)
        }
        if (chart && chartRef.current === chart) {
          chartRef.current = null
        }
        if (chart && !chart.isDisposed()) {
          chart.dispose()
        }
      }
    }, [])

    React.useLayoutEffect(() => {
      const setOptionOptions: SetOptionOpts = { notMerge, lazyUpdate }
      chartRef.current?.setOption(option, setOptionOptions)
    }, [lazyUpdate, notMerge, option])

    return (
      <div
        ref={containerRef}
        data-slot="echarts-view"
        className={cn("min-h-0 min-w-0", className)}
        {...props}
      />
    )
  },
)

EChartsView.displayName = "EChartsView"
