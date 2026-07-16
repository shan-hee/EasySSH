export function resolveAPIErrorMessage(detail: unknown, fallback: string): string {
  const resolved = resolveDetailMessage(detail)
  return resolved || fallback
}

function resolveDetailMessage(detail: unknown): string | undefined {
  if (typeof detail === "string") {
    return detail.trim() || undefined
  }
  if (!detail || typeof detail !== "object") {
    return undefined
  }

  const record = detail as Record<string, unknown>
  if (typeof record.message === "string" && record.message.trim()) {
    return record.message.trim()
  }
  if (typeof record.error === "string" && record.error.trim()) {
    return record.error.trim()
  }

  return resolveDetailMessage(record.error)
    || resolveDetailMessage(record.details)
    || resolveDetailMessage(record.detail)
}
