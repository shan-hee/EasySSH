import { sftpApi } from "@easyssh/app/lib/api/sftp"
import { withServerConnection } from "@easyssh/app/lib/api/connections"
import type { SshWorkspaceApiClient } from "@easyssh/app/lib/session/workspace"
import type { TerminalAuthPrompt } from "@easyssh/app/lib/websocket-terminal"
import * as Remote from "../../bindings/github.com/easyssh/easyssh-desktop/internal/app/desktopremoteworkspaceservice"
import { readRemoteStream, decodeRemoteBytes } from "./remote-stream"

/** Browsing and mutations reuse the shared protocol; native streams handle interactive authentication. */
export const remoteFileApi: NonNullable<SshWorkspaceApiClient["sftp"]> = {
  ...sftpApi,
  async authenticate() {
    throw new Error("Visitor credentials must be configured by the owner")
  },
  deliverArtifact: undefined,
  async preAuthenticate(serverId, _credential, onPrompt) {
    await withServerConnection(serverId, "files", async (connection) => {
      const stream = await Remote.OpenFileAuthentication(connection)
      await new Promise<void>((resolve, reject) => {
        let settled = false
        const stop = readRemoteStream(
          stream.id,
          (frame) => {
            if (frame.encoding !== "event.json")
              throw new Error("Unexpected file authentication frame")
            const event = JSON.parse(
              new TextDecoder().decode(decodeRemoteBytes(frame.data)),
            ) as {
              type?: string
              data?: TerminalAuthPrompt & { message?: string; error?: string }
            }
            if (event.type === "authenticated") {
              settled = true
              stop()
              resolve()
            } else if (event.type === "error") {
              settled = true
              stop()
              reject(
                new Error(
                  event.data?.message ||
                    event.data?.error ||
                    "Authentication failed",
                ),
              )
            } else if (event.type === "auth_prompt" && event.data) {
              const prompt = event.data
              onPrompt(prompt, (response, cancelled) => {
                const answers = Array.isArray(response)
                  ? response
                  : (response.answers ?? [])
                void Remote.AnswerFileChallenge(
                  stream.id,
                  prompt.request_id,
                  answers,
                  !!cancelled,
                ).catch((error) => {
                  settled = true
                  stop()
                  reject(error)
                })
              })
            }
          },
          (reason) => {
            if (!settled) {
              if (reason === "authenticated") resolve()
              else reject(new Error(reason || "Authentication interrupted"))
            }
          },
        )
      })
    })
  },
  // Upload selection and delivery are owned by the native remote transfer UI.
  async uploadFile() {
    throw new Error("Use the native upload picker")
  },
  async downloadFile() {
    throw new Error("Native transfer manager required")
  },
  async batchDownload() {
    throw new Error("Native transfer manager required")
  },
}
