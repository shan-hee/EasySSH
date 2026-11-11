import type { AccessContext as NativeAccessContext } from "../../bindings/github.com/easyssh/shared/protocol/models"
import type { components } from "@easyssh/app/generated/openapi"

type AccessContext = components["schemas"]["AccessContext"]
type Action = components["schemas"]["Action"]

const resourceActions: Action[] = [
  "terminal.connect",
  "vnc.connect",
  "rdp.connect",
  "files.list",
  "files.read",
  "files.download",
  "files.upload",
  "files.write",
  "files.delete",
  "monitor.read",
  "docker.read",
  "docker.manage",
  "scripts.execute",
  "ai.use",
  "activity.read",
]
function action(value: string): Action {
  const found = resourceActions.find((action) => action === value)
  if (!found) throw new Error("Unsupported shared resource action")
  return found
}
/** Reject zero-value native enums rather than treating them as an owner session. */
export function remoteAccessContext(value: NativeAccessContext): AccessContext {
  if (
    value.protocol_version !== 1 ||
    value.actor.kind !== "access_session" ||
    !value.actor.session_id
  )
    throw new Error("Unsupported remote access context")
  if (
    typeof value.expires_at !== "string" ||
    !Number.isFinite(Date.parse(value.expires_at))
  )
    throw new Error("Invalid access expiry")
  return {
    ...value,
    protocol_version: 1,
    actor: { ...value.actor, kind: "access_session" },
    resources: value.resources.map((r) => ({
      ...r,
      actions: r.actions.map(action),
      allow_interactive: r.allow_interactive ?? undefined,
    })),
  }
}
