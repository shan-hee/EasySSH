import * as React from "react"
import createGlobe, { type COBEOptions, type Globe, type Marker } from "cobe"
import { useTranslation } from "react-i18next"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useTheme } from "@/components/theme-provider"
import { getCountryCoord } from "@/lib/country-coords"
import type { OverviewRegionCount } from "@/lib/api/dashboard"
import { cn } from "@/lib/utils"

interface ServerDistributionProps {
  distribution: OverviewRegionCount[]
  loading?: boolean
}

interface GlobeMarker {
  key: string
  id: string
  name: string
  count: number
  location: [number, number]
  size: number
}

interface GlobeDragState {
  pointerId: number
  clientX: number
  clientY: number
  lastClientX: number
  lastClientY: number
  lastTimestamp: number
  phi: number
  theta: number
}

type GlobeAppearance = Pick<
  COBEOptions,
  | "baseColor"
  | "dark"
  | "diffuse"
  | "glowColor"
  | "mapBaseBrightness"
  | "mapBrightness"
  | "markerColor"
  | "opacity"
>

type MarkerAnchorStyle = React.CSSProperties & {
  positionAnchor: string
}

const INITIAL_LONGITUDE = 105
const INITIAL_LATITUDE = 20
const MIN_THETA = -0.55
const MAX_THETA = 0.55
const AUTO_ROTATE_SPEED = 0.0015
const ACTIVE_MARKER_COLOR: [number, number, number] = [0.08, 0.9, 0.58]

function getRegionKey(item: OverviewRegionCount, index: number) {
  return `${item.country_code}-${item.region}-${index}`
}

function locationToAngles([latitude, longitude]: [number, number]) {
  return {
    phi: Math.PI * 1.5 - (longitude * Math.PI) / 180,
    theta: clampTheta((latitude * Math.PI) / 180),
  }
}

function shortestAngleDistance(target: number, current: number) {
  const fullTurn = Math.PI * 2
  return ((target - current + Math.PI) % fullTurn + fullTurn) % fullTurn - Math.PI
}

function clampTheta(theta: number) {
  return Math.min(MAX_THETA, Math.max(MIN_THETA, theta))
}

function getGlobeAppearance(isDark: boolean): GlobeAppearance {
  return isDark
    ? {
        dark: 1,
        diffuse: 1.4,
        mapBrightness: 7,
        mapBaseBrightness: 0.08,
        baseColor: [0.24, 0.27, 0.28],
        markerColor: [0.03, 0.75, 0.5],
        glowColor: [0.12, 0.16, 0.15],
        opacity: 0.92,
      }
    : {
        dark: 0,
        diffuse: 1.4,
        mapBrightness: 9,
        mapBaseBrightness: 0.03,
        baseColor: [0.94, 0.96, 0.96],
        markerColor: [0.02, 0.68, 0.45],
        glowColor: [0.93, 0.97, 0.95],
        opacity: 0.88,
      }
}

/**
 * Cobe 交互式服务器地球。
 *
 * WebGL 实例只创建一次；实时分布、主题和容器尺寸通过 update() 更新。
 * 页面不可见时暂停渲染，卸载时主动释放 WebGL 上下文。
 */
export function ServerDistribution({ distribution, loading }: ServerDistributionProps) {
  const { t } = useTranslation("dashboard")
  const { resolvedTheme } = useTheme()
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const globeHostRef = React.useRef<HTMLDivElement>(null)
  const globeRef = React.useRef<Globe | null>(null)
  const dragStateRef = React.useRef<GlobeDragState | null>(null)
  const velocityRef = React.useRef({ phi: 0, theta: 0 })
  const focusTargetRef = React.useRef<{ phi: number; theta: number } | null>(null)
  const rotationRef = React.useRef(
    locationToAngles([INITIAL_LATITUDE, INITIAL_LONGITUDE]),
  )
  const markersRef = React.useRef<Marker[]>([])
  const appearanceRef = React.useRef<GlobeAppearance>(getGlobeAppearance(false))
  const [isDragging, setIsDragging] = React.useState(false)
  const [activeRegionKey, setActiveRegionKey] = React.useState<string | null>(null)
  const [expandedRegionKey, setExpandedRegionKey] = React.useState<string | null>(null)

  const maxCount = React.useMemo(
    () => Math.max(1, ...distribution.map((item) => item.count)),
    [distribution],
  )
  const globeMarkers = React.useMemo<GlobeMarker[]>(() => (
    distribution.flatMap((item, index) => {
      const coordinate = getCountryCoord(item.country_code)
      if (!coordinate) return []
      const [longitude, latitude] = coordinate
      const marker: GlobeMarker = {
        key: getRegionKey(item, index),
        id: `easyssh-region-${index}`,
        name: item.region,
        count: item.count,
        location: [latitude, longitude],
        size: 0.022 + (item.count / maxCount) * 0.024,
      }
      return [marker]
    })
  ), [distribution, maxCount])
  const markerByRegionKey = React.useMemo(
    () => new Map(globeMarkers.map((marker) => [marker.key, marker])),
    [globeMarkers],
  )
  const cobeMarkers = React.useMemo<Marker[]>(() => (
    globeMarkers.map((marker) => ({
      id: marker.id,
      location: marker.location,
      size: marker.size,
      color: marker.key === activeRegionKey || marker.key === expandedRegionKey
        ? ACTIVE_MARKER_COLOR
        : undefined,
    }))
  ), [activeRegionKey, expandedRegionKey, globeMarkers])
  const appearance = React.useMemo(
    () => getGlobeAppearance(resolvedTheme === "dark"),
    [resolvedTheme],
  )

  React.useLayoutEffect(() => {
    markersRef.current = cobeMarkers
    appearanceRef.current = appearance
  }, [appearance, cobeMarkers])

  const focusMarker = React.useCallback((marker: GlobeMarker | undefined) => {
    focusTargetRef.current = marker ? locationToAngles(marker.location) : null
    if (marker) {
      velocityRef.current = { phi: 0, theta: 0 }
    }
  }, [])

  const previewRegion = React.useCallback((regionKey: string) => {
    setActiveRegionKey(regionKey)
    focusMarker(markerByRegionKey.get(regionKey))
  }, [focusMarker, markerByRegionKey])

  const highlightRegion = React.useCallback((regionKey: string) => {
    setActiveRegionKey(regionKey)
  }, [])

  const finishRegionPreview = React.useCallback(() => {
    setActiveRegionKey(expandedRegionKey)
    focusTargetRef.current = null
  }, [expandedRegionKey])

  const toggleRegion = React.useCallback((marker: GlobeMarker) => {
    const next = expandedRegionKey === marker.key ? null : marker.key
    setExpandedRegionKey(next)
    setActiveRegionKey(next)
  }, [expandedRegionKey])

  React.useEffect(() => {
    globeRef.current?.update({ markers: cobeMarkers })
  }, [cobeMarkers])

  React.useEffect(() => {
    globeRef.current?.update(appearance)
  }, [appearance])

  React.useEffect(() => {
    if (loading) return
    const canvas = canvasRef.current
    const host = globeHostRef.current
    if (!canvas || !host) return

    const initialWidth = Math.max(1, host.clientWidth)
    const initialHeight = Math.max(1, host.clientHeight)
    const initialRotation = rotationRef.current
    const globe = createGlobe(canvas, {
      devicePixelRatio: Math.min(window.devicePixelRatio || 1, 1.75),
      width: initialWidth,
      height: initialHeight,
      phi: initialRotation.phi,
      theta: initialRotation.theta,
      mapSamples: 12000,
      scale: 1.12,
      offset: [0, 0],
      markerElevation: 0.015,
      markers: markersRef.current,
      ...appearanceRef.current,
    })
    globeRef.current = globe

    let isVisible = true
    let animationFrame = 0
    let resizeTimer: number | undefined
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      isVisible = entry?.isIntersecting ?? true
    })
    const resizeObserver = new ResizeObserver(([entry]) => {
      const width = Math.max(1, Math.round(entry.contentRect.width))
      const height = Math.max(1, Math.round(entry.contentRect.height))
      window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(() => {
        globe.update({ width, height })
      }, 72)
    })
    intersectionObserver.observe(host)
    resizeObserver.observe(host)

    const render = () => {
      animationFrame = window.requestAnimationFrame(render)
      if (!isVisible || document.hidden) return

      const rotation = rotationRef.current
      const focusTarget = focusTargetRef.current
      if (!dragStateRef.current) {
        if (focusTarget) {
          const phiDistance = shortestAngleDistance(focusTarget.phi, rotation.phi)
          const thetaDistance = focusTarget.theta - rotation.theta
          rotation.phi += phiDistance * 0.085
          rotation.theta += thetaDistance * 0.085

          if (Math.abs(phiDistance) < 0.004 && Math.abs(thetaDistance) < 0.004) {
            focusTargetRef.current = null
          }
        } else {
          rotation.phi += velocityRef.current.phi
          rotation.theta = clampTheta(rotation.theta + velocityRef.current.theta)
          velocityRef.current.phi *= 0.95
          velocityRef.current.theta *= 0.95

          if (!reducedMotion.matches) {
            rotation.phi += AUTO_ROTATE_SPEED
          }
        }
      }

      globe.update({ phi: rotation.phi, theta: rotation.theta })
    }
    render()
    window.requestAnimationFrame(() => {
      canvas.style.opacity = "1"
    })

    return () => {
      window.cancelAnimationFrame(animationFrame)
      window.clearTimeout(resizeTimer)
      intersectionObserver.disconnect()
      resizeObserver.disconnect()
      globe.destroy()
      globeRef.current = null

      // Cobe v2 会为 CSS Anchor 注入一层 wrapper；还原 DOM 以兼容 React Strict Mode 重挂载。
      const cobeWrapper = canvas.parentElement
      if (cobeWrapper && cobeWrapper !== host && cobeWrapper.parentElement === host) {
        host.insertBefore(canvas, cobeWrapper)
        cobeWrapper.remove()
      }
    }
  }, [loading])

  const handlePointerDown = React.useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return
    const rotation = rotationRef.current
    const timestamp = performance.now()
    dragStateRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      lastTimestamp: timestamp,
      phi: rotation.phi,
      theta: rotation.theta,
    }
    velocityRef.current = { phi: 0, theta: 0 }
    focusTargetRef.current = null
    setActiveRegionKey(null)
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsDragging(true)
  }, [])

  const handlePointerMove = React.useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const dragState = dragStateRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) return

    const rotation = rotationRef.current
    rotation.phi = dragState.phi + (event.clientX - dragState.clientX) / 300
    rotation.theta = clampTheta(
      dragState.theta + (event.clientY - dragState.clientY) / 1000,
    )
    const timestamp = performance.now()
    const elapsed = Math.max(timestamp - dragState.lastTimestamp, 1)
    velocityRef.current = {
      phi: Math.max(
        -0.15,
        Math.min(0.15, ((event.clientX - dragState.lastClientX) / elapsed) * 0.3),
      ),
      theta: Math.max(
        -0.15,
        Math.min(0.15, ((event.clientY - dragState.lastClientY) / elapsed) * 0.08),
      ),
    }
    dragState.lastClientX = event.clientX
    dragState.lastClientY = event.clientY
    dragState.lastTimestamp = timestamp
  }, [])

  const finishPointerDrag = React.useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragStateRef.current?.pointerId !== event.pointerId) return
    dragStateRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setIsDragging(false)
  }, [])

  return (
    <Card className="h-full gap-0 overflow-hidden py-4">
      <CardHeader className="shrink-0 pb-2">
        <CardTitle className="text-base">{t("serverDistribution")}</CardTitle>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 pt-2">
        <div className="flex h-full min-h-0 flex-col gap-3 xl:flex-row">
          <div className="relative h-[170px] min-w-0 flex-1 overflow-hidden rounded-md 2xl:h-[210px]">
            {loading ? (
              <div className="h-full w-full animate-pulse rounded-lg bg-primary/5" />
            ) : (
              <div
                ref={globeHostRef}
                className="relative h-full w-full contain-[layout_paint_size]"
                role="group"
                aria-label={t("serverDistribution")}
              >
                <canvas
                  ref={canvasRef}
                  className={cn(
                    "h-full w-full touch-none select-none opacity-0 transition-opacity duration-500",
                    isDragging ? "cursor-grabbing" : "cursor-grab",
                  )}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={finishPointerDrag}
                  onPointerCancel={finishPointerDrag}
                  onLostPointerCapture={() => {
                    dragStateRef.current = null
                    setIsDragging(false)
                  }}
                />

                {globeMarkers.map((marker) => {
                  const isExpanded = expandedRegionKey === marker.key
                  const isActive = activeRegionKey === marker.key
                  const displayName = marker.name || t("unknownRegion")
                  const serverCountLabel = t("mapServerCount", { count: marker.count })
                  return (
                    <button
                      key={marker.key}
                      type="button"
                      className={cn(
                        "cobe-server-marker absolute z-20 flex max-w-36 flex-col items-center rounded-md border px-2 py-1 text-xs shadow-md backdrop-blur-sm transition-[opacity,filter,scale,padding,background-color] duration-200",
                        isActive || isExpanded
                          ? "scale-105 border-emerald-500/40 bg-emerald-600 text-white"
                          : "border-border/70 bg-popover/90 text-popover-foreground hover:scale-105",
                      )}
                      style={{
                        positionAnchor: `--cobe-${marker.id}`,
                        bottom: "anchor(top)",
                        left: "anchor(center)",
                        translate: "-50% 0",
                        marginBottom: 6,
                        opacity: `var(--cobe-visible-${marker.id}, 0)`,
                        visibility: `var(--cobe-visible-${marker.id}, hidden)` as React.CSSProperties["visibility"],
                        filter: `blur(calc((1 - var(--cobe-visible-${marker.id}, 0)) * 6px))`,
                      } as MarkerAnchorStyle}
                      aria-expanded={isExpanded}
                      aria-label={`${displayName}: ${serverCountLabel}`}
                      onPointerEnter={() => highlightRegion(marker.key)}
                      onPointerLeave={finishRegionPreview}
                      onFocus={() => highlightRegion(marker.key)}
                      onBlur={finishRegionPreview}
                      onClick={() => toggleRegion(marker)}
                    >
                      <span className="max-w-32 truncate font-medium">{displayName}</span>
                      {isExpanded ? (
                        <span className="animate-in fade-in-0 slide-in-from-top-1 whitespace-nowrap text-[10px] opacity-85 duration-150">
                          {serverCountLabel}
                        </span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div className="scrollbar-custom grid w-full shrink-0 grid-cols-1 gap-1 overflow-auto sm:grid-cols-2 xl:block xl:max-h-full xl:w-44 xl:space-y-1 2xl:w-48">
            {loading ? (
              Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="h-8 w-full animate-pulse rounded bg-primary/5" />
              ))
            ) : distribution.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">{t("noData")}</p>
            ) : (
              distribution.slice(0, 6).map((item, index) => {
                const regionKey = getRegionKey(item, index)
                const marker = markerByRegionKey.get(regionKey)
                const isActive = activeRegionKey === regionKey || expandedRegionKey === regionKey
                const displayName = item.region || t("unknownRegion")
                return (
                  <button
                    key={regionKey}
                    type="button"
                    disabled={!marker}
                    className={cn(
                      "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors disabled:cursor-default disabled:opacity-100",
                      isActive ? "bg-muted/70" : marker ? "hover:bg-muted/50" : "",
                    )}
                    aria-label={`${displayName}: ${t("mapServerCount", { count: item.count })}`}
                    onPointerEnter={() => marker && previewRegion(regionKey)}
                    onPointerLeave={() => marker && finishRegionPreview()}
                    onFocus={() => marker && previewRegion(regionKey)}
                    onBlur={() => marker && finishRegionPreview()}
                    onClick={() => marker && toggleRegion(marker)}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={cn(
                          "h-2 w-2 shrink-0 rounded-full transition-transform duration-150",
                          item.count > 0 ? "bg-emerald-500" : "bg-muted-foreground/30",
                          isActive && "scale-125",
                        )}
                      />
                      <span className="truncate text-muted-foreground">{displayName}</span>
                    </span>
                    <span className="shrink-0 font-medium tabular-nums">{item.count}</span>
                  </button>
                )
              })
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
