// The worker owns SSH protocol state. Only the encrypted SSH stream is sent to
// the relay; credentials and terminal plaintext stay in this browser runtime.
type GoRuntime = {
  importObject: WebAssembly.Imports
  run(instance: WebAssembly.Instance): Promise<void>
}
type WorkerScope = {
  Go: new () => GoRuntime
  easysshDispatch?: (message: string) => void
  postMessage(message: string): void
  onmessage: ((event: MessageEvent<string>) => void) | null
  location: Location
}
const scope = globalThis as unknown as WorkerScope
const fail = (message: string) => {
  scope.postMessage(JSON.stringify({ type: "error", data: message }))
  scope.postMessage(JSON.stringify({ type: "closed", data: null }))
}

scope.onmessage = (event) => {
  if (typeof event.data !== "string" || event.data.length > 2 << 20) {
    fail("Invalid browser SSH command")
    return
  }
  if (!scope.easysshDispatch) {
    fail("Browser SSH runtime is not ready")
    return
  }
  scope.easysshDispatch(event.data)
}

async function boot() {
  const base = new URL(`${import.meta.env.BASE_URL}browser-ssh/`, scope.location.origin)
  await import(/* @vite-ignore */ new URL("wasm_exec.js", base).href)
  const runtime = new scope.Go()
  const response = await fetch(new URL("ssh.wasm", base), { credentials: "same-origin" })
  if (!response.ok || !response.headers.get("content-type")?.includes("application/wasm")) {
    throw new Error("Browser SSH runtime is unavailable")
  }
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), runtime.importObject)
  await runtime.run(instance)
  fail("Browser SSH runtime stopped")
}

void boot().catch((error: unknown) => fail(error instanceof Error ? error.message : "Browser SSH runtime failed"))

export {}
