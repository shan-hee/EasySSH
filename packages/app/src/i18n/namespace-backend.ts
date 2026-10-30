import type { BackendModule } from "i18next"

type Catalog = Record<string, unknown>
export type NamespaceLoaders = Record<string, () => Promise<Catalog>>

export function createNamespaceBackend(
  loaders: NamespaceLoaders,
  onError: (error: Error) => void,
): BackendModule {
  return {
    type: "backend",
    init() {},
    read(language, namespace, callback) {
      const load = loaders[`./messages/${language}/${namespace}.json`]
      if (!load) {
        const error = new Error(`Unknown translation namespace: ${language}/${namespace}`)
        onError(error)
        callback(error, false)
        return
      }
      void load().then(
        (messages) => callback(null, messages),
        (cause: unknown) => {
          const error = cause instanceof Error ? cause : new Error(String(cause))
          onError(error)
          callback(error, false)
        },
      )
    },
  }
}
