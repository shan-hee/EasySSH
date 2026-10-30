import { withServerConnection } from "@easyssh/app/lib/api/connections"
import type { PlatformTransport } from "@easyssh/app/contracts/platform-transport"
import type { Server } from "@easyssh/app/lib/server-types"
import * as Remote from "../../bindings/github.com/easyssh/easyssh-desktop/internal/app/desktopremoteworkspaceservice"
import * as P from "../../bindings/github.com/easyssh/shared/protocol/models"
import { decodeRemoteBytes, remoteAIResponse } from "./remote-stream"

// This address is an internal dispatch key. No network request is sent by the renderer.
const origin = "https://remote-workspace.invalid"
const base = `${origin}/api/v1`
const json = (value: unknown) => Response.json(value ?? {})
export function resourceServer(r: P.AccessResource): Server {
  return {
    id: r.id,
    name: r.name,
    host: r.host,
    port: r.port,
    username: r.username,
    auth_method: "password",
    status: "offline",
    created_at: "",
    updated_at: "",
  }
}

let available = false
const credentialListeners = new Set<() => void>()
export function setRemoteAvailable(value: boolean) {
  if (available === value) return
  available = value
  credentialListeners.forEach((listener) => listener())
}
export function remoteAccessEnded(error: unknown): boolean {
  return [
    "access_ended",
    "invalid_access",
    "reauthorization_required",
    "workspace_closed",
  ].some((code) => String(error).includes(code))
}

/** Explicit endpoint-to-binding mapping; unknown routes never fall back to local APIs or fetch. */
export const remoteTransport: PlatformTransport = {
  apiBaseUrl: () => base,
  webSocketUrl: () => {
    throw new Error("Use the native remote stream adapter")
  },
  requestHeaders: async () => ({}),
  hasCredentials: () => available,
  subscribeCredentials: (listener) => {
    credentialListeners.add(listener)
    return () => {
      credentialListeners.delete(listener)
    }
  },
  async fetch(input, init) {
    if (!available)
      return Response.json(
        { error: "access_ended", message: "Access session has ended" },
        { status: 401 },
      )
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (url.origin !== origin || !url.pathname.startsWith("/api/v1/"))
      throw new Error("Request outside remote workspace")
    request.signal.throwIfAborted()
    const path = url.pathname
      .slice(7)
      .split("/")
      .filter(Boolean)
      .map(decodeURIComponent)
    const [group, id, action, subid, tail] = path
    const q = url.searchParams
    const method = request.method
    const query = Object.fromEntries(q)
    const body =
      method === "GET" || method === "HEAD"
        ? {}
        : await request
            .text()
            .then((text) =>
              text ? (JSON.parse(text) as Record<string, unknown>) : {},
            )
    const connection = request.headers.get("X-EasySSH-Connection") || ""
    try {
      if (group === "connections") {
        if (!id && method === "POST")
          return json(
            await Remote.CreateConnection(
              String(body.server_id),
              body.mode as P.ConnectionMode,
            ),
          )
        if (id && !action && method === "DELETE")
          return json(await Remote.CloseConnection(id))
        if (id && action === "heartbeat" && method === "POST")
          return json(await Remote.HeartbeatConnection(id))
      }
      if (group === "servers" && method === "GET") {
        const context = await Remote.Context()
        const servers = context.access.resources
          .filter((r) => !r.paused)
          .map(resourceServer)
        if (id) {
          const found = servers.find((s) => s.id === id)
          return found
            ? json(found)
            : Response.json(
                { message: "Resource unavailable" },
                { status: 404 },
              )
        }
        const page = Number(q.get("page")) || 1,
          limit = Number(q.get("limit")) || 100
        return json({
          data: servers.slice((page - 1) * limit, page * limit),
          total: servers.length,
          page,
          limit,
        })
      }
      if (group === "ai") {
        if (id === "config" && method === "GET")
          return json(await Remote.RemoteAIConfig())
        if (id === "sessions") {
          const session = action,
            kind = subid,
            item = tail
          if (!session && method === "GET")
            return json(
              await Remote.ListRemoteAISessions(
                P.AIListInput.createFrom({
                  ...query,
                  page: Number(q.get("page")) || 1,
                  limit: Number(q.get("limit")) || 20,
                }),
              ),
            )
          if (!session && method === "POST")
            return json(
              await Remote.CreateRemoteAISession(
                P.CreateAISessionRequest.createFrom(body),
              ),
            )
          if (session && !kind) {
            if (method === "GET")
              return json(await Remote.GetRemoteAISession(session))
            if (method === "DELETE")
              return json(await Remote.DeleteRemoteAISession(session))
            if (method === "PATCH")
              return json(
                await Remote.RenameRemoteAISession(session, String(body.title)),
              )
          }
          if (session && kind === "history" && method === "GET")
            return json(
              await Remote.RemoteAIHistory(
                session,
                P.AIHistoryInput.createFrom({
                  ...query,
                  limit: Number(q.get("limit")) || 100,
                }),
              ),
            )
          if (session && kind === "cancel" && method === "POST")
            return json(await Remote.CancelRemoteAISession(session))
          if (session && kind === "messages" && item) {
            if (method === "PATCH")
              return json(
                await Remote.UpdateRemoteAIMessage(
                  session,
                  item,
                  P.UpdateAIMessageRequest.createFrom(body),
                ),
              )
            if (method === "DELETE")
              return json(await Remote.DeleteRemoteAIMessage(session, item))
          }
          if (
            session &&
            kind === "tasks" &&
            item &&
            path[5] === "file" &&
            method === "GET"
          )
            return json(await Remote.GetRemoteAITaskFile(session, item))
          if (session && kind === "chat") {
            const stream =
              method === "POST"
                ? await Remote.OpenRemoteAIChat(
                    session,
                    P.AISDKChatRequest.createFrom(body),
                  )
                : method === "GET"
                  ? await Remote.ResumeRemoteAIChat(session)
                  : null
            if (stream) return remoteAIResponse(stream.id, request.signal)
          }
        }
      }
      if (group === "content" && id && method === "GET") {
        const ref = await Remote.GetRemoteContent(id)
        if (!action) return json(ref)
        if (action === "bytes")
          return json(
            await Remote.ReadRemoteContent(
              ref,
              new P.ContentReadInput({
                offset: Number(q.get("offset")) || 0,
                sha256: q.get("sha256") || ref.sha256,
              }),
            ),
          )
      }
      if (group === "tasks") {
        if (!id && method === "GET")
          return json(
            await Remote.ListRemoteTasks(
              P.TaskListInput.createFrom({
                page: Number(q.get("page")) || 1,
                page_size: Number(q.get("page_size")) || 50,
                keyword: q.get("keyword") || "",
                statuses: q.get("status")?.split(","),
                task_types: q.get("task_type")?.split(","),
                trigger_types: q.get("trigger_type")?.split(","),
              }),
            ),
          )
        if (id === "statistics" && method === "GET")
          return json(await Remote.RemoteTaskStatistics())
        if (id && !action && method === "GET")
          return json(await Remote.GetRemoteTask(id))
        if (id && action === "events" && method === "GET")
          return json(
            await Remote.ListRemoteTaskEvents(
              id,
              new P.TaskEventInput({
                after_id: Number(q.get("after_id")) || 0,
                limit: Number(q.get("limit")) || 50,
              }),
            ),
          )
        if (id && action === "cancel" && method === "POST")
          return json(await Remote.CancelRemoteTask(id))
      }
      if (group === "scripts") {
        if (id === "available" && method === "GET")
          return json(
            await Remote.AvailableRemoteScripts(
              q.get("server_id") || "",
              new P.ScriptCatalogInput({
                after_id: q.get("after_id") || "",
                limit: Number(q.get("limit")) || 100,
              }),
            ),
          )
        if (id && action === "execute" && method === "POST")
          return json(
            await Remote.ExecuteRemoteScript(
              id,
              P.ScriptExecuteInput.createFrom(body),
            ),
          )
      }
      if (group === "operation-records" && method === "GET") {
        if (id === "overview")
          return json(
            await Remote.RemoteActivityOverview(
              P.ActivityOverviewInput.createFrom({
                ...query,
                page: Number(q.get("page")) || 1,
                page_size: Number(q.get("page_size")) || 10,
              }),
            ),
          )
        if (id) return json(await Remote.GetRemoteActivity(id))
      }
      if (group === "sftp" && id && connection) {
        const remotePath = q.get("path") ?? String(body.path ?? "~")
        if (action === "list" && method === "GET")
          return json(await Remote.ListRemoteDirectory(connection, remotePath))
        if (action === "stat" && method === "GET")
          return json(await Remote.StatRemoteFile(connection, remotePath))
        if (action === "disk-usage" && method === "GET")
          return json(await Remote.RemoteDiskUsage(connection, remotePath))
        if (action === "read" && method === "GET")
          return new Response(
            decodeRemoteBytes(
              await Remote.ReadRemoteFile(connection, remotePath),
            ),
            { headers: { "Content-Type": "text/plain" } },
          )
        if (action === "write" && method === "POST")
          return json(
            await Remote.WriteRemoteFile(
              connection,
              remotePath,
              String(body.content ?? ""),
            ),
          )
        if (action === "mkdir" && method === "POST")
          return json(
            await Remote.CreateRemoteDirectory(connection, remotePath, false),
          )
        if (action === "delete" && method === "DELETE")
          return json(await Remote.DeleteRemoteFile(connection, remotePath))
        if (action === "delete-paths" && method === "POST")
          return json(
            await Remote.DeleteRemotePaths(connection, body.paths as string[]),
          )
        if (action === "batch-delete" && method === "POST")
          return json(
            await Remote.BatchDeleteRemoteFiles(
              connection,
              body.paths as string[],
            ),
          )
        if (action === "rename" && method === "POST")
          return json(
            await Remote.RenameRemoteFile(
              connection,
              String(body.old_path),
              String(body.new_path),
            ),
          )
        if (action === "chmod" && method === "POST")
          return json(
            await Remote.ChmodRemoteFile(
              connection,
              remotePath,
              String(body.mode),
            ),
          )
      }
      if (group === "docker" && id && connection) {
        if (action === "containers" && !subid && method === "GET")
          return json(
            await Remote.ListDockerContainers(
              connection,
              q.get("all") === "true",
            ),
          )
        if (action === "stats" && method === "GET")
          return json(await Remote.DockerStats(connection))
        if (action === "images" && method === "GET")
          return json(await Remote.ListDockerImages(connection))
        if (action === "system" && method === "GET")
          return json({ data: await Remote.DockerSystemInfo(connection) })
        if (action === "resources" && method === "GET")
          return json(await Remote.DockerResources(connection))
        if (action === "tasks" && subid && method === "GET")
          return json(await Remote.DockerActionResult(connection, subid))
        if (action === "containers" && subid) {
          if (tail === "stats" && method === "GET")
            return json(await Remote.DockerContainerStats(connection, subid))
          if (tail === "logs" && method === "GET")
            return json(
              await Remote.DockerContainerLogs(
                connection,
                subid,
                Number(q.get("tail")) || 100,
                q.get("encoding") || "utf-8",
              ),
            )
          if (tail === "check-update" && method === "GET")
            return json({
              data: await Remote.CheckDockerImageUpdate(connection, subid),
            })
          if (!tail && method === "DELETE")
            return json(
              await Remote.ApplyDockerAction(
                connection,
                subid,
                P.DockerAction.DockerActionRemove,
                q.get("force") === "true",
              ),
            )
          if (
            method === "POST" &&
            (tail === "start" ||
              tail === "stop" ||
              tail === "restart" ||
              tail === "pause" ||
              tail === "unpause")
          )
            return json(
              await Remote.ApplyDockerAction(
                connection,
                subid,
                {
                  start: P.DockerAction.DockerActionStart,
                  stop: P.DockerAction.DockerActionStop,
                  restart: P.DockerAction.DockerActionRestart,
                  pause: P.DockerAction.DockerActionPause,
                  unpause: P.DockerAction.DockerActionUnpause,
                }[tail],
                false,
              ),
            )
        }
      }
      if (group === "transfer-jobs") {
        if (id === "sftp" && action === "relay" && method === "POST")
          return json(
            await withServerConnection(
              String(body.source_server_id),
              "files",
              (source) =>
                withServerConnection(
                  String(body.target_server_id),
                  "files",
                  (target) =>
                    Remote.StartRemoteRelay(
                      new P.RemoteTransferRelayInput({
                        source_connection_id: source,
                        target_connection_id: target,
                        source_path: String(body.source_path),
                        target_path: String(body.target_path),
                      }),
                    ),
                ),
            ),
          )
        if (!id && method === "GET")
          return json(
            await Remote.ListRemoteTransfers(
              P.TransferListInput.createFrom({
                ...query,
                page: Number(q.get("page")) || 1,
                page_size: Number(q.get("page_size")) || 50,
              }),
            ),
          )
        if (id && !action && method === "GET")
          return json(await Remote.GetRemoteTransfer(id))
        if (id && action === "cancel" && method === "POST")
          return json(await Remote.CancelRemoteTransfer(id))
      }
      return Response.json(
        { message: "This operation is unavailable in a remote workspace" },
        { status: 403 },
      )
    } catch (error) {
      const message = String(error)
      if (remoteAccessEnded(error)) {
        setRemoteAvailable(false)
        return Response.json(
          { message, error: "access_ended" },
          { status: 401 },
        )
      }
      const code = [
        "connection_unavailable",
        "resource_paused",
        "keyboard_interactive_required",
        "sftp_credential_required",
        "access_session_ended",
      ].find((code) => message.includes(code))
      return Response.json(
        { message, error: code },
        {
          status:
            code === "connection_unavailable" || code === "resource_paused"
              ? 403
              : code === "keyboard_interactive_required" ||
                  code === "sftp_credential_required"
                ? 428
                : 400,
        },
      )
    }
  },
}
