import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react"
import createGlobe, { type COBEOptions, type Globe, type Marker } from "cobe"
import { useTranslation } from "react-i18next"

import { useEffectiveThemeMode } from "@/hooks/use-effective-theme-mode"
import { hexToRgb } from "@/lib/color-utils"
import { getCountryCoord } from "@/lib/country-coords"
import type { OverviewRegionCount } from "@/lib/api/dashboard"
import { cn } from "@/lib/utils"

interface InteractiveLocation {
  id: string
  name: string
  location: [number, number]
  count: number
  size: number
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

type MarkerAnchorStyle = CSSProperties & {
  positionAnchor: string
}

const MIN_THETA = -0.45
const MAX_THETA = 0.45

function clampTheta(theta: number) {
  return Math.min(MAX_THETA, Math.max(MIN_THETA, theta))
}

function readThemeColor(token: string, fallback: [number, number, number]) {
  if (typeof document === "undefined") return fallback

  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(`--${token}`)
    .trim()
  const rgb = hexToRgb(value)
  return rgb
    ? rgb.map((channel) => channel / 255) as [number, number, number]
    : fallback
}

function mixColor(
  from: [number, number, number],
  to: [number, number, number],
  amount: number,
): [number, number, number] {
  return from.map((channel, index) => (
    channel + (to[index] - channel) * amount
  )) as [number, number, number]
}

function getInteractiveAppearance(isDark: boolean, themeRevision = 0): GlobeAppearance {
  // CSS token changes are external to React values; the revision intentionally invalidates memoized reads.
  void themeRevision
  const background = readThemeColor(
    "background",
    isDark ? [0.08, 0.08, 0.08] : [0.98, 0.98, 0.98],
  )
  const foreground = readThemeColor(
    "foreground",
    isDark ? [0.98, 0.98, 0.98] : [0.12, 0.12, 0.12],
  )
  const primary = readThemeColor(
    "primary",
    isDark ? [0.92, 0.92, 0.92] : [0.12, 0.18, 0.38],
  )

  return {
    dark: isDark ? 1 : 0,
    diffuse: 1.5,
    mapBrightness: 10,
    mapBaseBrightness: isDark ? 0.045 : 0.025,
    baseColor: isDark
      ? mixColor(background, foreground, 0.24)
      : mixColor(background, foreground, 0.025),
    markerColor: primary,
    glowColor: background,
    opacity: isDark ? 0.9 : 0.78,
  }
}

export function DashboardGlobe({
  distribution,
}: {
  distribution: OverviewRegionCount[]
}) {
  const { t } = useTranslation("dashboard")
  const { mode, version } = useEffectiveThemeMode()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const globeRef = useRef<Globe | null>(null)
  const appearanceRef = useRef<GlobeAppearance>(getInteractiveAppearance(mode === "dark"))
  const markersRef = useRef<Marker[]>([])
  const rotationRef = useRef({ phi: 4.35, theta: 0.17 })
  const dragRef = useRef<{
    pointerId: number
    x: number
    y: number
    phi: number
    theta: number
  } | null>(null)
  const [expandedLocationId, setExpandedLocationId] = useState<string | null>(null)

  const interactiveLocations = useMemo<InteractiveLocation[]>(() => {
    const maxCount = Math.max(1, ...distribution.map((item) => item.count))
    return distribution.flatMap((item, index) => {
      const coordinate = getCountryCoord(item.country_code)
      if (!coordinate) return []
      const [longitude, latitude] = coordinate
      return [{
        id: `dashboard-region-${item.country_code.toLowerCase()}-${index}`,
        name: item.region || item.country_code,
        location: [latitude, longitude],
        count: item.count,
        size: 0.018 + (item.count / maxCount) * 0.018,
      }]
    })
  }, [distribution])
  const interactiveMarkers = useMemo<Marker[]>(() => (
    interactiveLocations.map((item) => ({
      id: item.id,
      location: item.location,
      size: item.size,
    }))
  ), [interactiveLocations])

  const appearance = useMemo(
    () => getInteractiveAppearance(mode === "dark", version),
    [mode, version],
  )

  useLayoutEffect(() => {
    appearanceRef.current = appearance
  }, [appearance])

  useLayoutEffect(() => {
    markersRef.current = interactiveMarkers
  }, [interactiveMarkers])

  useEffect(() => {
    globeRef.current?.update(appearance)
  }, [appearance])

  useEffect(() => {
    globeRef.current?.update({ markers: interactiveMarkers })
  }, [interactiveMarkers])

  useEffect(() => {
    const canvas = canvasRef.current
    const host = hostRef.current
    if (!canvas || !host) return

    const width = Math.max(1, host.clientWidth)
    const height = Math.max(1, host.clientHeight)
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)")
    let visible = true
    let animationFrame = 0
    let resizeTimer: number | undefined

    const globe = createGlobe(canvas, {
      devicePixelRatio: Math.min(window.devicePixelRatio || 1, 1.75),
      width,
      height,
      phi: rotationRef.current.phi,
      theta: rotationRef.current.theta,
      mapSamples: 16_000,
      scale: 1,
      offset: [0, -8],
      markerElevation: 0,
      markers: markersRef.current,
      ...appearanceRef.current,
    })
    globeRef.current = globe

    const intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true
    })
    const resizeObserver = new ResizeObserver(([entry]) => {
      const nextWidth = Math.max(1, Math.round(entry.contentRect.width))
      const nextHeight = Math.max(1, Math.round(entry.contentRect.height))
      window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(() => {
        globe.update({ width: nextWidth, height: nextHeight })
      }, 60)
    })

    intersectionObserver.observe(host)
    resizeObserver.observe(host)

    const render = () => {
      animationFrame = window.requestAnimationFrame(render)
      if (!visible || document.hidden) return
      if (!dragRef.current && !reduceMotion.matches) {
        rotationRef.current.phi += 0.00125
      }
      globe.update(rotationRef.current)
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

      const cobeWrapper = canvas.parentElement
      if (cobeWrapper && cobeWrapper !== host && cobeWrapper.parentElement === host) {
        host.insertBefore(canvas, cobeWrapper)
        cobeWrapper.remove()
      }
    }
  }, [])

  return (
    <div
      ref={hostRef}
      className="relative size-full contain-[layout_paint_size]"
      role="group"
      aria-label={t("orbitGlobeLabel")}
    >
      <canvas
        ref={canvasRef}
        className="size-full cursor-grab touch-none select-none opacity-0 transition-opacity duration-1000 active:cursor-grabbing"
        onPointerDown={(event) => {
          if (event.button !== 0) return
          dragRef.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            phi: rotationRef.current.phi,
            theta: rotationRef.current.theta,
          }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current
          if (!drag || drag.pointerId !== event.pointerId) return
          rotationRef.current.phi = drag.phi + (event.clientX - drag.x) / 260
          rotationRef.current.theta = clampTheta(drag.theta + (event.clientY - drag.y) / 720)
        }}
        onPointerUp={(event) => {
          if (dragRef.current?.pointerId !== event.pointerId) return
          dragRef.current = null
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
        }}
        onPointerCancel={() => {
          dragRef.current = null
        }}
        onLostPointerCapture={() => {
          dragRef.current = null
        }}
      />

      {interactiveLocations.map((location) => {
        const expanded = expandedLocationId === location.id
        return (
          <button
            key={location.id}
            type="button"
            className={cn(
              "cobe-server-marker dashboard-interactive-marker",
              expanded && "is-expanded",
            )}
            style={{
              positionAnchor: `--cobe-${location.id}`,
              bottom: "anchor(top)",
              left: "anchor(center)",
              translate: "-50% -0.45rem",
              opacity: `var(--cobe-visible-${location.id}, 0)`,
              visibility: `var(--cobe-visible-${location.id}, hidden)` as CSSProperties["visibility"],
              filter: `blur(calc((1 - var(--cobe-visible-${location.id}, 0)) * 8px))`,
            } as MarkerAnchorStyle}
            aria-expanded={expanded}
            aria-label={t("orbitInteractiveLocationLabel", {
              region: location.name,
              count: location.count,
            })}
            onClick={() => {
              setExpandedLocationId((current) => (
                current === location.id ? null : location.id
              ))
            }}
          >
            <span className="dashboard-interactive-name">{location.name}</span>
            {expanded ? (
              <span className="dashboard-interactive-detail">
                {t("mapServerCount", { count: location.count })}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
