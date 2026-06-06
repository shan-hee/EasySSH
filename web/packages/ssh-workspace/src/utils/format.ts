export function formatBytesString(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return "0 B"

  const base = 1024
  const precision = decimals < 0 ? 0 : decimals
  const units = ["B", "KB", "MB", "GB", "TB", "PB"]
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(base)), units.length - 1)
  const value = Number.parseFloat((bytes / Math.pow(base, unitIndex)).toFixed(precision))

  return `${value} ${units[unitIndex]}`
}

export function formatSpeed(bytesPerSecond: number, decimals: number = 1): string {
  if (bytesPerSecond === 0) return "0 B/s"

  const base = 1024
  const precision = decimals < 0 ? 0 : decimals
  const units = ["B/s", "KB/s", "MB/s", "GB/s"]
  const unitIndex = Math.min(Math.floor(Math.log(bytesPerSecond) / Math.log(base)), units.length - 1)
  const value = Number.parseFloat((bytesPerSecond / Math.pow(base, unitIndex)).toFixed(precision))

  return `${value} ${units[unitIndex]}`
}

export function formatRemainingTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--"

  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = Math.floor(seconds % 60)

  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`
  }

  return `${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`
}
