import { useCallback, useRef, useState } from "react"
import { isApiError } from "@/lib/api-client"
import type { Server } from "@/lib/server-types"
import type { SftpSessionApi } from "@/lib/session/sftp-session-api"
import type { DirectTransferOptions, DirectTransferResponse, SftpTransferCredential } from "@/lib/sftp-types"
import type {
  TerminalAuthMethod,
  TerminalAuthPrompt,
  TerminalAuthResponsePayload,
  TerminalHostKeyPrompt,
  TerminalHostKeyResponder,
} from "@/lib/websocket-terminal"
import { TerminalAuthChallengeDialog } from "@/components/terminal/terminal-auth-challenge-dialog"
import { TerminalHostKeyDialog } from "@/components/terminal/terminal-host-key-dialog"
import type { TerminalAuthFlowAdapters } from "@/components/terminal/use-terminal-auth-flow"
import {
  authMethodCredentialFields,
  normalizeSSHAuthMethod,
  requiresPrivateKey,
  supportsKeyboardInteractive,
} from "@/lib/ssh-auth-methods"

type TerminalTranslator = (key: string, params?: Record<string, string | number>) => string

type CredentialPromptState =
  | {
      mode: "credential"
      serverName: string
      prompt: TerminalAuthPrompt
      resolve: (credential: SftpCredentialInput) => void
      reject: (error: Error) => void
    }
  | {
      mode: "passphrase"
      serverName: string
      prompt: TerminalAuthPrompt
      resolve: (passphrase: string) => void
      reject: (error: Error) => void
    }
  | {
      mode: "interactive"
      serverName: string
      prompt: TerminalAuthPrompt
      resolve: (response: SftpInteractiveAuthResponse) => void
      reject: (error: Error) => void
    }

type SftpCredentialInput = {
  authMethod: TerminalAuthMethod
  secret?: string
  password?: string
  privateKey?: string
  privateKeyPassphrase?: string
}

type SftpInteractiveAuthResponse = {
  response: string[] | TerminalAuthResponsePayload
  authMethod?: TerminalAuthMethod
}

export interface RunSftpCredentialRetryOptions<T> {
  serverId: string
  serverName: string
  authMethod: TerminalAuthMethod
  api: Pick<SftpSessionApi, "authenticate" | "preAuthenticate">
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
  api?: Pick<SftpSessionApi, "authenticate" | "preAuthenticate">
  operation: (options?: DirectTransferOptions) => Promise<DirectTransferResponse>
}

export interface UseSftpAuthRetryOptions {
  tTerminal: TerminalTranslator
  adapters?: TerminalAuthFlowAdapters
}

export function isSftpCredentialRequiredError(error: unknown) {
  const code = stripSftpTransferCredentialErrorSide(getApiErrorCode(error))
  if (
    code === "sftp_credential_required" ||
    code === "keyboard_interactive_required" ||
    code === "sftp_private_key_passphrase_required" ||
    code === "sftp_private_key_passphrase_invalid"
  ) {
    return true
  }

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
      message.includes("keyboard_interactive_required") ||
      message.includes("failed to decrypt password") ||
      message.includes("failed to decrypt private key")
    )
  }

  return false
}

function getApiErrorCode(error: unknown) {
  if (isApiError(error)) {
    const detail = error.detail
    if (detail && typeof detail === "object") {
      const detailObj = detail as { error?: unknown }
      return typeof detailObj.error === "string" ? detailObj.error : null
    }
  }

  if (error instanceof Error && "code" in error) {
    const code = (error as Error & { code?: unknown }).code
    return typeof code === "string" ? code : null
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

export function isSftpKeyboardInteractiveRequiredError(error: unknown) {
  const code = stripSftpTransferCredentialErrorSide(getApiErrorCode(error))
  if (code === "keyboard_interactive_required") {
    return true
  }

  if (error instanceof Error) {
    return error.message.toLowerCase().includes("keyboard_interactive_required")
  }

  return false
}

export function formatSftpAuthError(
  error: unknown,
  fallbackMessage: string,
  tTerminal: TerminalTranslator,
) {
  if (isSftpKeyboardInteractiveRequiredError(error)) {
    return tTerminal("terminalErrorKeyboardInteractiveRequired")
  }
  return fallbackMessage
}

function isSftpHostKeyChangedError(error: unknown) {
  const code = stripSftpTransferCredentialErrorSide(getApiErrorCode(error))
  if (code === "host_key_changed" || code === "sftp_host_key_changed") {
    return true
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    return (
      message.includes("host key verification failed") ||
      message.includes("ssh host key verification failed")
    )
  }

  if (isApiError(error) && typeof error.detail === "object" && error.detail !== null) {
    const detail = error.detail as { message?: unknown }
    const message = typeof detail.message === "string" ? detail.message.toLowerCase() : ""
    return (
      message.includes("host key verification failed") ||
      message.includes("ssh host key verification failed")
    )
  }

  return false
}

function toSftpTransferCredential(credential: {
  authMethod: TerminalAuthMethod
  secret?: string
  password?: string
  privateKey?: string
  privateKeyPassphrase?: string
}): SftpTransferCredential {
  return {
    auth_method: credential.authMethod,
    secret: credential.secret,
    password: credential.password,
    private_key: credential.privateKey,
    private_key_passphrase: credential.privateKeyPassphrase,
  }
}

export function getServerAuthMethod(server: Pick<Server, "auth_method">): TerminalAuthMethod {
  return normalizeSSHAuthMethod(server.auth_method)
}

const SFTP_CREDENTIAL_MAX_ATTEMPTS = 3

export function useSftpAuthRetry({
  tTerminal,
  adapters,
}: UseSftpAuthRetryOptions) {
  const [credentialPrompt, setCredentialPrompt] = useState<CredentialPromptState | null>(null)
  const [hostKeyWarning, setHostKeyWarning] = useState<{
    prompt: TerminalHostKeyPrompt
    respond: TerminalHostKeyResponder
  } | null>(null)
  const [hostKeyTrusting, setHostKeyTrusting] = useState(false)
  const hostKeyResponseSentRef = useRef(false)

  const requestCredential = useCallback((serverName: string, authMethod: TerminalAuthMethod, attempt: number) => (
    new Promise<SftpCredentialInput>((resolve, reject) => {
      const prompts = authMethodCredentialFields(authMethod).map((field) => ({
        text: field === "key"
          ? tTerminal("authRetryPrivateKeyLabel")
          : tTerminal("authRetryPasswordLabel"),
        echo: false,
      }))

      setCredentialPrompt({
        mode: "credential",
        serverName,
        resolve,
        reject,
        prompt: {
          request_id: `sftp-credential-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          kind: "credential_retry",
          prompts,
          auth_method: authMethod,
          attempt,
          max_attempts: SFTP_CREDENTIAL_MAX_ATTEMPTS,
          attempts_remaining: SFTP_CREDENTIAL_MAX_ATTEMPTS - attempt,
        },
      })
    })
  ), [tTerminal])

  const requestInteractiveResponse = useCallback((serverName: string, prompt: TerminalAuthPrompt) => (
    new Promise<SftpInteractiveAuthResponse>((resolve, reject) => {
      setCredentialPrompt({
        mode: "interactive",
        serverName,
        prompt,
        resolve,
        reject,
      })
    })
  ), [])

  const handleHostKeyPrompt = useCallback((
    prompt: TerminalHostKeyPrompt,
    respond: TerminalHostKeyResponder,
  ) => {
    hostKeyResponseSentRef.current = false
    setHostKeyWarning({ prompt, respond })
  }, [])

  const handleTrustHostKey = useCallback(() => {
    if (!hostKeyWarning || hostKeyResponseSentRef.current) {
      return
    }

    setHostKeyTrusting(true)
    try {
      hostKeyResponseSentRef.current = true
      hostKeyWarning.respond(true, hostKeyWarning.prompt.received_key)
      adapters?.notifySuccess?.(tTerminal("hostKeyChangedSuccess"))
      setHostKeyWarning(null)
    } finally {
      setHostKeyTrusting(false)
    }
  }, [adapters, hostKeyWarning, tTerminal])

  const handleCancelHostKey = useCallback(() => {
    if (!hostKeyWarning || hostKeyResponseSentRef.current) {
      return
    }

    hostKeyResponseSentRef.current = true
    hostKeyWarning.respond(false)
    setHostKeyWarning(null)
  }, [hostKeyWarning])

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
      options?: {
        password?: string
        privateKey?: string
      },
    ) => {
      if (!adapters?.requestCredentialSave || !adapters.saveCredential) {
        return
      }
      const saveSecret = secret || options?.password || options?.privateKey
      if (!saveSecret) {
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
            secret: saveSecret,
            password: options?.password,
            privateKey: options?.privateKey,
          }).then(() => {
            adapters.notifySuccess?.(tTerminal("authRetrySaveSuccess"))
        }).catch((error) => {
          console.error("[SFTP] 保存补充凭据失败:", error)
          adapters.notifyError?.(tTerminal("authRetrySaveFailed"))
        })
      },
    })
  }, [adapters, tTerminal])

  const authenticateForSftp = useCallback(async (
    api: Pick<SftpSessionApi, "authenticate" | "preAuthenticate">,
    serverId: string,
    serverName: string,
    credential: SftpCredentialInput,
  ) => {
    if (api.preAuthenticate) {
      await api.preAuthenticate(serverId, {
        authMethod: credential.authMethod,
        password: credential.password,
        privateKey: credential.privateKey,
        secret: credential.secret,
        privateKeyPassphrase: credential.privateKeyPassphrase,
      }, async (prompt, respond) => {
        try {
          const { response, authMethod } = await requestInteractiveResponse(serverName, prompt)
          respond(response, false, authMethod)
        } catch {
          respond([], true)
        }
      }, handleHostKeyPrompt)
      return
    }

    if (!api.authenticate) {
      throw new Error("sftp authentication is not available")
    }

    await api.authenticate(
      serverId,
      credential.authMethod,
      credential.secret ?? "",
      credential.privateKeyPassphrase,
      {
        password: credential.password,
        privateKey: credential.privateKey,
      },
    )
  }, [handleHostKeyPrompt, requestInteractiveResponse])

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
      if (!api.authenticate && !api.preAuthenticate) {
        throw error
      }

      if (api.preAuthenticate && isSftpHostKeyChangedError(error)) {
        await authenticateForSftp(
          api,
          serverId,
          serverName,
          { authMethod },
        )
        return await operation()
      }

      if (requiresPrivateKey(authMethod) && isSftpPrivateKeyPassphraseError(error)) {
        let passphraseError = error

        for (let passphraseAttempt = 1; passphraseAttempt <= SFTP_CREDENTIAL_MAX_ATTEMPTS; passphraseAttempt++) {
          const passphrase = await requestPrivateKeyPassphrase(serverName, passphraseAttempt)

          try {
            await authenticateForSftp(
              api,
              serverId,
              serverName,
              {
                authMethod,
                privateKeyPassphrase: passphrase,
              },
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

      if (api.preAuthenticate) {
        try {
          await authenticateForSftp(
            api,
            serverId,
            serverName,
            { authMethod: nextAuthMethod },
          )
          return await operation()
        } catch (preAuthError) {
          if (requiresPrivateKey(nextAuthMethod) && isSftpPrivateKeyPassphraseError(preAuthError)) {
            lastError = preAuthError
            for (let passphraseAttempt = 1; passphraseAttempt <= SFTP_CREDENTIAL_MAX_ATTEMPTS; passphraseAttempt++) {
              const passphrase = await requestPrivateKeyPassphrase(serverName, passphraseAttempt)

              try {
                await authenticateForSftp(
                  api,
                  serverId,
                  serverName,
                  {
                    authMethod: nextAuthMethod,
                    privateKeyPassphrase: passphrase,
                  },
                )
                return await operation()
              } catch (nextPassphraseError) {
                lastError = nextPassphraseError
                if (!isSftpPrivateKeyPassphraseError(nextPassphraseError)) {
                  throw nextPassphraseError
                }
              }
            }

            throw lastError
          }

          lastError = preAuthError
          if (!isSftpCredentialRequiredError(preAuthError)) {
            throw preAuthError
          }
        }
      }

      for (let attempt = 1; attempt <= SFTP_CREDENTIAL_MAX_ATTEMPTS; attempt++) {
        const credential = await requestCredential(serverName, nextAuthMethod, attempt)
        nextAuthMethod = credential.authMethod

        try {
          await authenticateForSftp(api, serverId, serverName, credential)

          const result = await operation()
          promptCredentialSave(
            serverId,
            serverName,
            credential.authMethod,
            credential.secret ?? credential.password ?? credential.privateKey ?? "",
            {
              password: credential.password,
              privateKey: credential.privateKey,
            },
          )
          return result
        } catch (retryError) {
          if (requiresPrivateKey(credential.authMethod) && isSftpPrivateKeyPassphraseError(retryError)) {
            let passphraseError = retryError

            for (let passphraseAttempt = 1; passphraseAttempt <= SFTP_CREDENTIAL_MAX_ATTEMPTS; passphraseAttempt++) {
              const passphrase = await requestPrivateKeyPassphrase(serverName, passphraseAttempt)

              try {
                await authenticateForSftp(
                  api,
                  serverId,
                  serverName,
                  {
                    ...credential,
                    privateKeyPassphrase: passphrase,
                  },
                )

                const result = await operation()
                promptCredentialSave(
                  serverId,
                  serverName,
                  credential.authMethod,
                  credential.secret ?? credential.password ?? credential.privateKey ?? "",
                  {
                    password: credential.password,
                    privateKey: credential.privateKey,
                  },
                )
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
  }, [authenticateForSftp, promptCredentialSave, requestCredential, requestPrivateKeyPassphrase])

  const runDirectTransferWithCredentialRetry = useCallback(async ({
    sourceServerId,
    sourceServerName,
    sourceAuthMethod,
    targetServerId,
    targetServerName,
    targetAuthMethod,
    api,
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
    const interactivePreAuthenticated = {
      source: false,
      target: false,
    }
    const hostKeyPreAuthenticated = {
      source: false,
      target: false,
    }
    const successfulCredentials: Partial<Record<"source" | "target", {
      authMethod: TerminalAuthMethod
      secret: string
      password?: string
      privateKey?: string
    }>> = {}
    let lastError: unknown = null

    const setCredential = (
      side: "source" | "target",
      credential: SftpTransferCredential,
      saveCandidate?: { authMethod: TerminalAuthMethod; secret?: string; password?: string; privateKey?: string },
    ) => {
      if (side === "source") {
        options.sourceCredential = credential
      } else {
        options.targetCredential = credential
      }

      const saveSecret = saveCandidate?.secret ?? saveCandidate?.password ?? saveCandidate?.privateKey
      if (saveCandidate && saveSecret) {
        successfulCredentials[side] = {
          authMethod: saveCandidate.authMethod,
          secret: saveSecret,
          password: saveCandidate.password,
          privateKey: saveCandidate.privateKey,
        }
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
            {
              password: credential.password,
              privateKey: credential.privateKey,
            },
          )
        }

        return result
      } catch (error) {
        lastError = error
        const side = getSftpTransferCredentialErrorSide(error)
        if (!side) {
          throw error
        }
        if (isSftpHostKeyChangedError(error)) {
          if (!api?.preAuthenticate || hostKeyPreAuthenticated[side]) {
            throw error
          }

          hostKeyPreAuthenticated[side] = true
          const existing = side === "source" ? options.sourceCredential : options.targetCredential
          await authenticateForSftp(api, serverIds[side], serverNames[side], {
            authMethod: existing?.auth_method ?? authMethods[side],
            secret: existing?.secret,
            password: existing?.password,
            privateKey: existing?.private_key,
            privateKeyPassphrase: existing?.private_key_passphrase,
          })
          if (side === "source") {
            delete options.sourceCredential
          } else {
            delete options.targetCredential
          }
          continue
        }
        if (!isSftpCredentialRequiredError(error)) {
          throw error
        }
        if (isSftpKeyboardInteractiveRequiredError(error)) {
          if (!api?.preAuthenticate || interactivePreAuthenticated[side] || !supportsKeyboardInteractive(authMethods[side])) {
            throw error
          }

          interactivePreAuthenticated[side] = true
          const existing = side === "source" ? options.sourceCredential : options.targetCredential
          await authenticateForSftp(api, serverIds[side], serverNames[side], {
            authMethod: existing?.auth_method ?? authMethods[side],
            secret: existing?.secret,
            password: existing?.password,
            privateKey: existing?.private_key,
            privateKeyPassphrase: existing?.private_key_passphrase,
          })
          if (side === "source") {
            delete options.sourceCredential
          } else {
            delete options.targetCredential
          }
          continue
        }

        if (requiresPrivateKey(authMethods[side]) && isSftpPrivateKeyPassphraseError(error)) {
          passphraseAttempts[side] += 1
          if (passphraseAttempts[side] > SFTP_CREDENTIAL_MAX_ATTEMPTS) {
            throw error
          }

          const passphrase = await requestPrivateKeyPassphrase(serverNames[side], passphraseAttempts[side])
          const existing = side === "source" ? options.sourceCredential : options.targetCredential
          setCredential(side, {
            auth_method: existing?.auth_method ?? authMethods[side],
            secret: existing?.secret ?? "",
            password: existing?.password,
            private_key: existing?.private_key,
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
  }, [authenticateForSftp, promptCredentialSave, requestCredential, requestPrivateKeyPassphrase])

  const credentialDialog = (
    <>
      <TerminalAuthChallengeDialog
        prompt={credentialPrompt?.prompt ?? null}
        serverName={credentialPrompt?.serverName ?? ""}
        onSubmit={(answers, authMethod) => {
          if (!credentialPrompt) {
            return
          }
          const payload: TerminalAuthResponsePayload & { authMethod?: TerminalAuthMethod } = Array.isArray(answers)
            ? { answers, authMethod }
            : {
                answers: answers.answers ?? [],
                authMethod: answers.authMethod ?? authMethod,
                password: answers.password,
                privateKey: answers.privateKey,
                privateKeyPassphrase: answers.privateKeyPassphrase,
              }
          const secret = payload.answers[0] ?? payload.password ?? payload.privateKey ?? ""
          const method = payload.authMethod ?? credentialPrompt.prompt.auth_method ?? "password"
          if (credentialPrompt.mode === "passphrase") {
            credentialPrompt.resolve(secret)
          } else if (credentialPrompt.mode === "interactive") {
            credentialPrompt.resolve({ response: payload, authMethod: method })
          } else {
            credentialPrompt.resolve({
              authMethod: method,
              secret,
              password: payload.password,
              privateKey: payload.privateKey,
              privateKeyPassphrase: payload.privateKeyPassphrase,
            })
          }
          setCredentialPrompt(null)
        }}
        onCancel={() => {
          credentialPrompt?.reject(new Error("authentication cancelled by user"))
          setCredentialPrompt(null)
        }}
      />
      <TerminalHostKeyDialog
        prompt={hostKeyWarning?.prompt ?? null}
        isTrusting={hostKeyTrusting}
        labels={{
          title: tTerminal("hostKeyChangedTitle"),
          description: tTerminal("hostKeyChangedDescription", {
            server: hostKeyWarning
              ? `${hostKeyWarning.prompt.host}:${hostKeyWarning.prompt.port}`
              : "",
          }),
          expected: tTerminal("hostKeyChangedExpected"),
          received: tTerminal("hostKeyChangedReceived"),
          risk: tTerminal("hostKeyChangedRisk"),
          cancel: tTerminal("hostKeyChangedCancel"),
          trust: tTerminal("hostKeyChangedTrust"),
          trusting: tTerminal("hostKeyChangedTrusting"),
        }}
        onCancel={handleCancelHostKey}
        onTrust={handleTrustHostKey}
      />
    </>
  )

  return {
    credentialDialog,
    runWithCredentialRetry,
    runDirectTransferWithCredentialRetry,
  }
}
