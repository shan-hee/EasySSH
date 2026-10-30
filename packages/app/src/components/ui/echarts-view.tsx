import * as React from "react"
import * as echarts from "echarts/core"
import { BarChart, LineChart, PieChart } from "echarts/charts"
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components"
import { CanvasRenderer } from "echarts/renderers"
import type { ECharts, EChartsOption, SetOptionOpts } from "echarts"

import { cn } from "@/lib/utils"

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
])

export interface EChartsViewHandle {
  getInstance: () => ECharts | null
}

interface EChartsViewProps extends Omit<React.ComponentProps<"div">, "children"> {
  option: EChartsOption
  notMerge?: boolean
  lazyUpdate?: boolean
  resizeDebounce?: number
}

/**
 * 由项目直接管理生命周期的 ECharts 容器。
 *
 * 实例与 ResizeObserver 在同一个 effect 中创建和销毁，确保 React StrictMode
 * 的重复挂载以及快速切换页面时不会留下图表实例或尺寸监听器。
 */
export const EChartsView = React.forwardRef<EChartsViewHandle, EChartsViewProps>(
  ({ className, option, notMerge = false, lazyUpdate = false, resizeDebounce = 80, ...props }, ref) => {
    const containerRef = React.useRef<HTMLDivElement | null>(null)
    const chartRef = React.useRef<ECharts | null>(null)
    const optionRef = React.useRef(option)
    const setOptionOptionsRef = React.useRef<SetOptionOpts>({ notMerge, lazyUpdate })
    const appliedOptionRef = React.useRef<{ option: EChartsOption; notMerge?: boolean; lazyUpdate?: boolean } | null>(null)

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
      let resizeTimer: number | null = null
      let lastWidth = 0
      let lastHeight = 0
      const applyChartSize = () => {
        if (resizeFrame !== null) {
          cancelAnimationFrame(resizeFrame)
        }
        resizeFrame = requestAnimationFrame(() => {
          resizeFrame = null
          const { width, height } = container.getBoundingClientRect()
          if (width <= 1 || height <= 1) return

          if (!chart || chart.isDisposed()) {
            chart = echarts.getInstanceByDom(container) ?? echarts.init(container, undefined, { width, height })
            chartRef.current = chart
            lastWidth = width
            lastHeight = height
            chart.setOption(optionRef.current, setOptionOptionsRef.current)
            appliedOptionRef.current = { option: optionRef.current, ...setOptionOptionsRef.current }
            return
          }
          if (lastWidth === width && lastHeight === height) return
          lastWidth = width
          lastHeight = height
          chart.resize({ width, height })
        })
      }
      const syncChartSize = () => {
        if (!chart || resizeDebounce <= 0) {
          applyChartSize()
          return
        }

        if (resizeTimer !== null) {
          window.clearTimeout(resizeTimer)
        }
        resizeTimer = window.setTimeout(() => {
          resizeTimer = null
          applyChartSize()
        }, resizeDebounce)
      }

      const resizeObserver = new ResizeObserver(syncChartSize)
      resizeObserver.observe(container)
      syncChartSize()

      return () => {
        resizeObserver.disconnect()
        if (resizeFrame !== null) {
          cancelAnimationFrame(resizeFrame)
        }
        if (resizeTimer !== null) {
          window.clearTimeout(resizeTimer)
        }
        if (chart && chartRef.current === chart) {
          chartRef.current = null
          appliedOptionRef.current = null
        }
        if (chart && !chart.isDisposed()) {
          chart.dispose()
        }
      }
    }, [resizeDebounce])

    React.useEffect(() => {
      // 让 React 先提交文本/交互状态，图表在下一帧应用最新配置；快速更新会取消旧帧。
      const frame = requestAnimationFrame(() => {
        const applied = appliedOptionRef.current
        if (applied?.option === option && applied.notMerge === notMerge && applied.lazyUpdate === lazyUpdate) return
        const chart = chartRef.current
        if (!chart || chart.isDisposed()) return
        chart.setOption(option, { notMerge, lazyUpdate })
        appliedOptionRef.current = { option, notMerge, lazyUpdate }
      })
      return () => cancelAnimationFrame(frame)
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
