import { viteEnv } from "@/lib/vite-env"

export const appVersion = viteEnv.VITE_APP_VERSION?.trim() ?? ""

export function getCurrentYear(): number {
  return new Date().getFullYear()
}
