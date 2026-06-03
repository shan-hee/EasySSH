type SafeViteEnv = Partial<ImportMetaEnv>

export const viteEnv: SafeViteEnv = import.meta.env ?? {}

export function isViteProd(): boolean {
  return viteEnv.PROD === true
}

export function isViteDev(): boolean {
  return viteEnv.DEV === true || !isViteProd()
}
