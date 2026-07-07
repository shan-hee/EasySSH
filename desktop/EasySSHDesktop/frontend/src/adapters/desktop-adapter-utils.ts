export function toFiniteNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  if (typeof value === "bigint") return Number(value)
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

export function mapNumberRecord(record?: Record<string, number | undefined>): Record<string, number> {
  const result: Record<string, number> = {}
  for (const [key, value] of Object.entries(record ?? {})) {
    if (typeof value === "number") {
      result[key] = value
    }
  }
  return result
}
