import { Call as $Call, type CancellablePromise as $CancellablePromise } from "@wailsio/runtime"

import type * as $models from "./models.js"

const service = "github.com/easyssh/easyssh-desktop.DesktopService"

export function RuntimeInfo(): $CancellablePromise<$models.DesktopRuntimeInfo> {
  return $Call.ByName(`${service}.RuntimeInfo`)
}

export function OpenDataDir(): $CancellablePromise<void> {
  return $Call.ByName(`${service}.OpenDataDir`)
}
