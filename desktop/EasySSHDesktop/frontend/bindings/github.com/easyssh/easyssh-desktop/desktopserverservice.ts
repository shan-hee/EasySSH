import { Call as $Call, type CancellablePromise as $CancellablePromise } from "@wailsio/runtime"

import type * as $models from "./models.js"

const service = "github.com/easyssh/easyssh-desktop.DesktopServerService"

export function List(params: $models.DesktopServerListParams): $CancellablePromise<$models.DesktopServerListResult> {
  return $Call.ByName(`${service}.List`, params)
}

export function GetById(id: string): $CancellablePromise<$models.DesktopServer> {
  return $Call.ByName(`${service}.GetById`, id)
}

export function Create(input: $models.DesktopServerInput): $CancellablePromise<$models.DesktopServer> {
  return $Call.ByName(`${service}.Create`, input)
}

export function Update(id: string, input: $models.DesktopServerInput): $CancellablePromise<$models.DesktopServer> {
  return $Call.ByName(`${service}.Update`, id, input)
}

export function Delete(id: string): $CancellablePromise<void> {
  return $Call.ByName(`${service}.Delete`, id)
}

export function Reorder(serverIds: string[]): $CancellablePromise<void> {
  return $Call.ByName(`${service}.Reorder`, serverIds)
}

export function MarkConnected(id: string): $CancellablePromise<$models.DesktopServer> {
  return $Call.ByName(`${service}.MarkConnected`, id)
}

export function ExecuteCommand(input: $models.DesktopServerCommandInput): $CancellablePromise<$models.DesktopServerCommandResult> {
  return $Call.ByName(`${service}.ExecuteCommand`, input)
}
