import { converter, formatHex, interpolate, parse, wcagContrast } from "culori"

export type RGB = [number, number, number]

const toRgb = converter("rgb")

const clamp = (value: number, min: number, max: number) => (
  Math.min(max, Math.max(min, value))
)

const parseColor = (value: string) => {
  const parsed = parse(value.trim())
  return parsed ? toRgb(parsed) : undefined
}

export function colorToHex(color: string): string {
  const rgb = parseColor(color)
  return rgb ? formatHex(rgb) ?? "#000000" : "#000000"
}

export function hexToRgb(value: string): RGB | null {
  const rgb = parseColor(value)
  if (!rgb) return null

  return [
    clamp(Math.round(rgb.r * 255), 0, 255),
    clamp(Math.round(rgb.g * 255), 0, 255),
    clamp(Math.round(rgb.b * 255), 0, 255),
  ]
}

export function rgbToHex(rgb: RGB): string {
  return formatHex({
    mode: "rgb",
    r: clamp(rgb[0], 0, 255) / 255,
    g: clamp(rgb[1], 0, 255) / 255,
    b: clamp(rgb[2], 0, 255) / 255,
  }) ?? "#000000"
}

export function mixHexColors(from: string, to: string, amount: number): string {
  const fromColor = parse(from) ?? parse("#000000")!
  const toColor = parse(to) ?? parse("#ffffff")!
  const mixed = interpolate([fromColor, toColor], "rgb")(clamp(amount, 0, 1))
  return formatHex(mixed) ?? "#000000"
}

export function contrastRatio(color: string, background: string): number {
  const foreground = parse(color)
  const backdrop = parse(background)
  if (!foreground || !backdrop) return 1
  return wcagContrast(foreground, backdrop)
}

export function ensureContrast(color: string, background: string, minimumRatio: number): string {
  const normalized = colorToHex(color)
  const normalizedBackground = colorToHex(background)
  if (contrastRatio(normalized, normalizedBackground) >= minimumRatio) {
    return normalized
  }

  const backgroundIsLight = contrastRatio("#000000", normalizedBackground) > contrastRatio("#ffffff", normalizedBackground)
  const target = backgroundIsLight ? "#000000" : "#ffffff"

  for (let step = 0.12; step <= 1; step += 0.08) {
    const mixed = mixHexColors(normalized, target, step)
    if (contrastRatio(mixed, normalizedBackground) >= minimumRatio) {
      return mixed
    }
  }

  return target
}
