type CryptoScope = {
  Go: new () => { importObject: WebAssembly.Imports; run(instance: WebAssembly.Instance): Promise<void> }
  easysshCryptoDispatch?: (input: string) => boolean
  postMessage(message: string): void
  onmessage: ((event: MessageEvent<string>) => void) | null
  location: Location
}
const scope = globalThis as unknown as CryptoScope
scope.onmessage = (event) => {
  try {
    if (typeof event.data !== "string" || event.data.length > 25 << 20) throw new Error("Invalid crypto request")
    if (!scope.easysshCryptoDispatch?.(event.data)) throw new Error("Crypto worker queue is full")
  } catch (error) {
    scope.postMessage(JSON.stringify({ id: "fatal", error: error instanceof Error ? error.message : "Crypto worker failed" }))
  }
}
async function boot() {
  const base = new URL(`${import.meta.env.BASE_URL}browser-ssh/`, scope.location.origin)
  await import(/* @vite-ignore */ new URL("wasm_exec.js", base).href)
  const runtime = new scope.Go()
  const response = await fetch(new URL("crypto.wasm", base), { credentials: "same-origin" })
  if (!response.ok || !response.headers.get("content-type")?.includes("application/wasm")) throw new Error("Client encryption runtime unavailable")
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), runtime.importObject)
  await runtime.run(instance)
  throw new Error("Client encryption runtime stopped")
}
void boot().catch((error: unknown) => scope.postMessage(JSON.stringify({ id: "fatal", error: error instanceof Error ? error.message : "Crypto worker failed" })))
export {}
