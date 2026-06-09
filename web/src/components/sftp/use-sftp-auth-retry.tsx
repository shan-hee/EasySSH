import { useCallback, useState } from "react"
import { isApiError } from "@/lib/api-client"
import type { Server } from "@/lib/server-types"
import type { SftpSessionApi } from "@/lib/session/sftp-session-api"
import type { DirectTransferOptions, DirectTransferResponse, SftpTransferCredential } from "@/lib/sftp-types"
import type { TerminalAuthMethod, TerminalAuthPrompt } from "@/lib/websocket-terminal"
import { TerminalAuthChallengeDialog } from "@/components/terminal/terminal-auth-challenge-dialog"
import type { TerminalAuthFlowAdapters } from "@/components/terminal/use-terminal-auth-flow"

type TerminalTranslator = (key: string, params?: Record<string, string | number>) => string

type CredentialPromptState =
  | {
      mode: "credential"
      serverName: string
      prompt: TerminalAuthPrompt
      resolve: (credential: { authMethod: TerminalAuthMethod; secret: string }) => void
      reject: (error: Error) => void
    }
  | {
      mode: "passphrase"
      serverName: string
      prompt: TerminalAuthPrompt
      resolve: (passphrase: string) => void
      reject: (error: Error) => void
    }

export interface RunSftpCredentialRetryOptions<T> {
  serverId: string
  serverName: string
  authMethod: TerminalAuthMethod
  api: Pick<SftpSessionApi, "authenticate">
  operation: () => Promise<T>
}

export interface RunSftpDirectTransferCredentialRetryOptions {
  sourceServerId: string
  sourcePath: string
  sourceServerName: string
  sourceAuthMethod: TerminalAuthMethod
  targetServerId: string
  targetPath: string
  targetServerName: string
  targetAuthMethod: TerminalAuthMethod
  operation: (options?: DirectTransferOptions) => Promise<DirectTransferResponse>
}

export interface UseSftpAuthRetryOptions {
  tTerminal: TerminalTranslator
  adapters?: TerminalAuthFlowAdapters
}

export function isSftpCredentialRequiredError(error: unknown) {
  if (isApiError(error)) {
    const detail = error.detail
    if (detail && typeof detail === "object") {
      const detailObj = detail as { error?: unknown }
      if (detailObj.error === "sftp_credential_required") {
        return true
      }
    }

    return error.status === 428
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    return (
      message.includes("sftp_credential_required") ||
      message.includes("server credential is required") ||
      message.includes("unable to authenticate") ||
      message.includes("permission denied") ||
      message.includes("authentication failed") ||
      message.includes("no supported methods remain") ||
      message.includes("failed to parse private key") ||
      message.includes("failed to decrypt password") ||
      message.includes("failed to decrypt private key")
    )
  }

  return false
}

function getApiErrorCode(error: unknown) {
  if (!isApiError(error)) {
    return null
  }

  const detail = error.detail
  if (detail && typeof detail === "object") {
    const detailObj = detail as { error?: unknown }
    return typeof detailObj.error === "string" ? detailObj.error : null
  }

  return null
}

function getSftpTransferCredentialErrorSide(error: unknown): "source" | "target" | null {
  const code = getApiErrorCode(error)
  if (code?.startsWith("source_")) {
    return "source"
  }
  if (code?.startsWith("target_")) {
    return "target"
  }

  return null
}

function stripSftpTransferCredentialErrorSide(code: string | null) {
  if (!code) {
    return null
  }
  if (code.startsWith("source_")) {
    return code.slice("source_".length)
  }
  if (code.startsWith("target_")) {
    return code.slice("target_".length)
  }
  return code
}

function isSftpPrivateKeyPassphraseError(error: unknown) {
  const code = stripSftpTransferCredentialErrorSide(getApiErrorCode(error))
  if (
    code === "sftp_private_key_passphrase_required" ||
    code === "sftp_private_key_passphrase_invalid"
  ) {
    return true
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    return (
      message.includes("private_key_passphrase_required") ||
      message.includes("private_key_passphrase_invalid")
    )
  }

  return false
}

function toSftpTransferCredential(credential: {
  authMethod: TerminalAuthMethod
  secret: string
  privateKeyPassphrase?: string
}): SftpTransferCredential {
  return {
    auth_method: credential.authMethod,
    secret: credential.secret,
    private_key_passphrase: credential.privateKeyPassphrase,
  }
}

export function getServerAuthMethod(server: Pick<Server, "auth_method">): TerminalAuthMethod {
  return server.auth_method === "key" ? "key" : "password"
}

const SFTP_CREDENTIAL_MAX_ATTEMPTS = 3

export function useSftpAuthRetry({
  tTerminal,
  adapters,
}: UseSftpAuthRetryOptions) {
  const [credentialPrompt, setCredentialPrompt] = useState<CredentialPromptState | null>(null)

  const requestCredential = useCallback((serverName: string, authMethod: TerminalAuthMethod, attempt: number) => (
    new Promise<{ authMethod: TerminalAuthMethod; secret: string }>((resolve, reject) => {
      setCredentialPrompt({
        mode: "credential",
        serverName,
        resolve,
        reject,
        prompt: {
          request_id: `sftp-credential-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          kind: "credential_retry",
          prompts: [{
            text: authMethod === "key"
              ? tTerminal("authRetryPrivateKeyLabel")
              : tTerminal("authRetryPasswordLabel"),
            echo: false,
          }],
          auth_method: authMethod,
          attempt,
          max_attempts: SFTP_CREDENTIAL_MAX_ATTEMPTS,
          attempts_remaining: SFTP_CREDENTIAL_MAX_ATTEMPTS - attempt,
        },
      })
    })
  ), [tTerminal])

  const requestPrivateKeyPassphrase = useCallback((serverName: string, attempt: number) => (
    new Promise<string>((resolve, reject) => {
      setCredentialPrompt({
        mode: "passphrase",
        serverName,
        resolve,
        reject,
        prompt: {
          request_id: `sftp-passphrase-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          kind: "private_key_passphrase",
          prompts: [{
            text: tTerminal("authPassphraseLabel"),
            echo: false,
          }],
          auth_method: "key",
          attempt,
          max_attempts: SFTP_CREDENTIAL_MAX_ATTEMPTS,
          attempts_remaining: SFTP_CREDENTIAL_MAX_ATTEMPTS - attempt,
        },
      })
    })
  ), [tTerminal])

  const promptCredentialSave = useCallback((
    serverId: string,
    serverName: string,
    authMethod: TerminalAuthMethod,
    secret: string,
  ) => {
    if (!adapters?.requestCredentialSave || !adapters.saveCredential) {
      return
    }

    adapters.requestCredentialSave({
      title: tTerminal("authRetrySavePrompt"),
      description: tTerminal("authRetrySaveDescription", { server: serverName }),
      actionLabel: tTerminal("authRetrySaveAction"),
      onConfirm: () => {
        void adapters.saveCredential?.({
          serverId,
          authMethod,
          secret,
        }).then(() => {
          adapters.notifySuccess?.(tTerminal("authRetrySaveSuccess"))
        }).catch((error) => {
          console.error("[SFTP] 保存补充凭据失败:", error)
          adapters.notifyError?.(tTerminal("authRetrySaveFailed"))
        })
      },
    })
  }, [adapters, tTerminal])

  const runWithCredentialRetry = useCallback(async <T,>({
    serverId,
    serverName,
    authMethod,
    api,
    operation,
  }: RunSftpCredentialRetryOptions<T>): Promise<T> => {
    try {
      return await operation()
    } catch (error) {
      if (!api.authenticate) {
        throw error
      }

      if (authMethod === "key" && isSftpPrivateKeyPassphraseError(error)) {
        let passphraseError = error

        for (let passphraseAttempt = 1; passphraseAttempt <= SFTP_CREDENTIAL_MAX_ATTEMPTS; passphraseAttempt++) {
          const passphrase = await requestPrivateKeyPassphrase(serverName, passphraseAttempt)

          try {
            await api.authenticate(
              serverId,
              "key",
              "",
              passphrase,
            )

            return await operation()
          } catch (nextPassphraseError) {
            passphraseError = nextPassphraseError
            if (!isSftpPrivateKeyPassphraseError(nextPassphraseError)) {
              throw nextPassphraseError
            }
          }
        }

        throw passphraseError
      }

      if (!isSftpCredentialRequiredError(error)) {
        throw error
      }

      let nextAuthMethod = authMethod
      let lastError = error

      for (let attempt = 1; attempt <= SFTP_CREDENTIAL_MAX_ATTEMPTS; attempt++) {
        const credential = await requestCredential(serverName, nextAuthMethod, attempt)
        nextAuthMethod = credential.authMethod

        try {
          await api.authenticate(
            serverId,
            credential.authMethod,
            credential.secret,
          )

          const result = await operation()
          promptCredentialSave(serverId, serverName, credential.authMethod, credential.secret)
          return result
        } catch (retryError) {
          if (credential.authMethod === "key" && isSftpPrivateKeyPassphraseError(retryError)) {
            let passphraseError = retryError

            for (let passphraseAttempt = 1; passphraseAttempt <= SFTP_CREDENTIAL_MAX_ATTEMPTS; passphraseAttempt++) {
              const passphrase = await requestPrivateKeyPassphrase(serverName, passphraseAttempt)

              try {
                await api.authenticate(
                  serverId,
                  credential.authMethod,
                  credential.secret,
                  passphrase,
                )

                const result = await operation()
                promptCredentialSave(serverId, serverName, credential.authMethod, credential.secret)
                return result
              } catch (nextPassphraseError) {
                passphraseError = nextPassphraseError
                if (!isSftpPrivateKeyPassphraseError(nextPassphraseError)) {
                  throw nextPassphraseError
                }
              }
            }

            lastError = passphraseError
            throw lastError
          }

          lastError = retryError
          if (!isSftpCredentialRequiredError(retryError)) {
            throw retryError
          }
        }
      }

      throw lastError
    }
  }, [promptCredentialSave, requestCredential, requestPrivateKeyPassphrase])

  const runDirectTransferWithCredentialRetry = useCallback(async ({
    sourceServerId,
    sourceServerName,
    sourceAuthMethod,
    targetServerId,
    targetServerName,
    targetAuthMethod,
    operation,
  }: RunSftpDirectTransferCredentialRetryOptions): Promise<DirectTransferResponse> => {
    const options: DirectTransferOptions = {}
    const authMethods: Record<"source" | "target", TerminalAuthMethod> = {
      source: sourceAuthMethod,
      target: targetAuthMethod,
    }
    const serverIds = {
      source: sourceServerId,
      target: targetServerId,
    }
    const serverNames = {
      source: sourceServerName,
      target: targetServerName,
    }
    const credentialAttempts = {
      source: 0,
      target: 0,
    }
    const passphraseAttempts = {
      source: 0,
      target: 0,
    }
    const successfulCredentials: Partial<Record<"source" | "target", {
      authMethod: TerminalAuthMethod
      secret: string
    }>> = {}
    let lastError: unknown = null

    const setCredential = (
      side: "source" | "target",
      credential: SftpTransferCredential,
      saveCandidate?: { authMethod: TerminalAuthMethod; secret: string },
    ) => {
      if (side === "source") {
        options.sourceCredential = credential
      } else {
        options.targetCredential = credential
      }
      if (saveCandidate?.secret) {
        successfulCredentials[side] = saveCandidate
      }
    }

    for (let attempt = 1; attempt <= SFTP_CREDENTIAL_MAX_ATTEMPTS * 4; attempt++) {
      try {
        const result = await operation(
          options.sourceCredential || options.targetCredential
            ? options
            : undefined,
        )
        for (const side of ["source", "target"] as const) {
          const credential = successfulCredentials[side]
          if (!credential) {
            continue
          }
          promptCredentialSave(
            serverIds[side],
            serverNames[side],
            credential.authMethod,
            credential.secret,
          )
        }
        return result
      } catch (error) {
        lastError = error
        const side = getSftpTransferCredentialErrorSide(error)
        if (!side || !isSftpCredentialRequiredError(error)) {
          throw error
        }

        if (authMethods[side] === "key" && isSftpPrivateKeyPassphraseError(error)) {
          passphraseAttempts[side] += 1
          if (passphraseAttempts[side] > SFTP_CREDENTIAL_MAX_ATTEMPTS) {
            throw error
          }
          const passphrase = await requestPrivateKeyPassphrase(serverNames[side], passphraseAttempts[side])
          const existing = side === "source" ? options.sourceCredential : options.targetCredential
          setCredential(side, {
            auth_method: "key",
            secret: existing?.secret ?? "",
            private_key_passphrase: passphrase,
          })
          continue
        }

        credentialAttempts[side] += 1
        if (credentialAttempts[side] > SFTP_CREDENTIAL_MAX_ATTEMPTS) {
          throw error
        }
        const credential = await requestCredential(serverNames[side], authMethods[side], credentialAttempts[side])
        authMethods[side] = credential.authMethod
        const nextCredential = toSftpTransferCredential(credential)
        setCredential(side, nextCredential, credential)
      }
    }

    throw lastError ?? new Error("sftp direct transfer authentication failed")
  }, [promptCredentialSave, requestCredential, requestPrivateKeyPassphrase])

  const credentialDialog = (
    <TerminalAuthChallengeDialog
      prompt={credentialPrompt?.prompt ?? null}
      serverName={credentialPrompt?.serverName ?? ""}
      onSubmit={(answers, authMethod) => {
        if (!credentialPrompt) {
          return
        }
        const secret = answers[0] ?? ""
        const method = authMethod ?? credentialPrompt.prompt.auth_method ?? "password"
        if (credentialPrompt.mode === "passphrase") {
          credentialPrompt.resolve(secret)
        } else {
          credentialPrompt.resolve({ authMethod: method, secret })
        }
        setCredentialPrompt(null)
      }}
      onCancel={() => {
        credentialPrompt?.reject(new Error("authentication cancelled by user"))
        setCredentialPrompt(null)
      }}
    />
  )

  return {
    credentialDialog,
    runWithCredentialRetry,
    runDirectTransferWithCredentialRetry,
  }
}
