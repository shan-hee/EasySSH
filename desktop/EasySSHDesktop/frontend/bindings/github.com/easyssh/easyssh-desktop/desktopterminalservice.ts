import { Call as $Call, type CancellablePromise as $CancellablePromise } from "@wailsio/runtime"

import type * as $models from "./models.js"

const service = "github.com/easyssh/easyssh-desktop.DesktopTerminalService"

export function Start(input: $models.DesktopTerminalStartInput): $CancellablePromise<void> {
  return $Call.ByName(`${service}.Start`, input)
}

export function Write(input: $models.DesktopTerminalWriteInput): $CancellablePromise<void> {
  return $Call.ByName(`${service}.Write`, input)
}

export function Resize(input: $models.DesktopTerminalResizeInput): $CancellablePromise<void> {
  return $Call.ByName(`${service}.Resize`, input)
}

export function Close(input: $models.DesktopTerminalCloseInput): $CancellablePromise<void> {
  return $Call.ByName(`${service}.Close`, input)
}
