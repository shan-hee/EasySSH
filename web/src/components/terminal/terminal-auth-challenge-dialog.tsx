
import { useEffect, useMemo, useRef, useState } from "react"
import type { FormEvent, RefObject } from "react"
import { KeyRound } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { TerminalAuthMethod, TerminalAuthPrompt, TerminalAuthResponsePayload } from "@/lib/websocket-terminal"
import {
  authMethodCredentialFields,
  authMethodLabelKey,
  normalizeSSHAuthMethod,
  SSH_AUTH_METHODS,
} from "@/lib/ssh-auth-methods"

export interface TerminalAuthChallengeDialogProps {
  prompt: TerminalAuthPrompt | null
  serverName: string
  onSubmit: (answers: string[] | TerminalAuthResponsePayload, authMethod?: TerminalAuthMethod) => void
  onCancel: () => void
}

function getAutocomplete(promptText: string, echo: boolean) {
  if (echo) {
    return "off"
  }

  const normalized = promptText.toLowerCase()
  if (
    normalized.includes("otp") ||
    normalized.includes("code") ||
    normalized.includes("验证码") ||
    normalized.includes("动态码") ||
    normalized.includes("passcode")
  ) {
    return "one-time-code"
  }

  return "current-password"
}

export function TerminalAuthChallengeDialog({
  prompt,
  serverName,
  onSubmit,
  onCancel,
}: TerminalAuthChallengeDialogProps) {
  const { t: tTerminal } = useTranslation("terminal")
  const { t: tServers } = useTranslation("servers")
  const [answers, setAnswers] = useState<string[]>([])
  const [authMethod, setAuthMethod] = useState<TerminalAuthMethod>("password")
  const [password, setPassword] = useState("")
  const [privateKey, setPrivateKey] = useState("")
  const firstInputRef = useRef<HTMLInputElement | null>(null)
  const firstTextAreaRef = useRef<HTMLTextAreaElement | null>(null)

  const prompts = useMemo(() => prompt?.prompts ?? [], [prompt])
  const isCredentialRetry = prompt?.kind === "credential_retry"
  const isPrivateKeyPassphrase = prompt?.kind === "private_key_passphrase"
  const credentialFields = useMemo(() => (
    isCredentialRetry ? authMethodCredentialFields(authMethod) : []
  ), [authMethod, isCredentialRetry])
  const needsPassword = credentialFields.includes("password")
  const needsPrivateKey = credentialFields.includes("key")

  useEffect(() => {
    let frame = 0
    if (!prompt) {
      frame = window.requestAnimationFrame(() => {
        setAnswers([])
        setAuthMethod("password")
        setPassword("")
        setPrivateKey("")
      })
      return () => window.cancelAnimationFrame(frame)
    }

    frame = window.requestAnimationFrame(() => {
      setAnswers(new Array(prompt.prompts.length).fill(""))
      setAuthMethod(normalizeSSHAuthMethod(prompt.auth_method))
      setPassword("")
      setPrivateKey("")
    })
    const timer = window.setTimeout(() => {
      const firstCredentialField = authMethodCredentialFields(prompt.auth_method)[0]
      if (prompt.kind === "credential_retry" && firstCredentialField === "key") {
        firstTextAreaRef.current?.focus()
        firstTextAreaRef.current?.select()
      } else {
        firstInputRef.current?.focus()
        firstInputRef.current?.select()
      }
    }, 0)

    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [prompt])

  useEffect(() => {
    if (!prompt) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onCancel()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onCancel, prompt])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isCredentialRetry) {
      onSubmit({
        answers: credentialFields.map((field) => (field === "password" ? password : privateKey)),
        authMethod,
        password: needsPassword ? password : undefined,
        privateKey: needsPrivateKey ? privateKey : undefined,
      }, authMethod)
      return
    }

    onSubmit(answers, isCredentialRetry ? authMethod : undefined)
  }

  const updateAnswer = (index: number, value: string) => {
    setAnswers((prev) => {
      const next = [...prev]
      next[index] = value
      return next
    })
  }

  const switchAuthMethod = (nextAuthMethod: TerminalAuthMethod) => {
    setAuthMethod(nextAuthMethod)
    setPassword("")
    setPrivateKey("")

    window.setTimeout(() => {
      if (authMethodCredentialFields(nextAuthMethod)[0] === "key") {
        firstTextAreaRef.current?.focus()
      } else {
        firstInputRef.current?.focus()
      }
    }, 0)
  }

  return (
    <Dialog open={Boolean(prompt)} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="flex max-h-[min(680px,calc(100vh-3rem))] w-[min(560px,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0">
        {prompt && (
          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="px-6 pt-6">
              <DialogHeader>
                <DialogTitle>
                  {isCredentialRetry
                    ? tTerminal("authRetryTitle")
                    : isPrivateKeyPassphrase
                      ? tTerminal("authPassphraseTitle")
                      : tTerminal("authChallengeTitle")}
                </DialogTitle>
                <DialogDescription>
                  {isCredentialRetry
                    ? tTerminal("authRetryServer", { server: serverName })
                    : isPrivateKeyPassphrase
                      ? tTerminal("authPassphraseServer", { server: serverName })
                      : tTerminal("authChallengeServer", { server: serverName })}
                </DialogDescription>
              </DialogHeader>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              {(prompt.name || prompt.instruction) && (
                <div className="rounded-md border border-border bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                  {prompt.name && <div className="font-medium">{prompt.name}</div>}
                  {prompt.instruction && (
                    <div className={prompt.name ? "mt-1 whitespace-pre-wrap" : "whitespace-pre-wrap"}>
                      {prompt.instruction}
                    </div>
                  )}
                </div>
              )}

              {isCredentialRetry && (
                <div className="mt-4 space-y-2">
                  <Label htmlFor={`terminal-auth-${prompt.request_id}-method`}>
                    {tTerminal("authRetryMethodLabel")}
                  </Label>
                  <Select value={authMethod} onValueChange={(value) => switchAuthMethod(value as TerminalAuthMethod)}>
                    <SelectTrigger id={`terminal-auth-${prompt.request_id}-method`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SSH_AUTH_METHODS.map((method) => (
                        <SelectItem key={method} value={method}>
                          {tServers(authMethodLabelKey(method))}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="mt-4 space-y-3">
                {isPrivateKeyPassphrase ? (
                  <div className="space-y-2">
                    <Label
                      htmlFor={`terminal-auth-${prompt.request_id}-passphrase`}
                      className="text-foreground"
                    >
                      {tTerminal("authPassphraseLabel")}
                    </Label>
                    <div className="relative">
                      <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        ref={firstInputRef}
                        id={`terminal-auth-${prompt.request_id}-passphrase`}
                        type="password"
                        value={answers[0] ?? ""}
                        onChange={(event) => updateAnswer(0, event.target.value)}
                        autoComplete="current-password"
                        required
                        className="pl-10"
                      />
                    </div>
                  </div>
                ) : isCredentialRetry ? (
                  credentialFields.map((field) => (
                    field === "password" ? (
                      <div key="password" className="space-y-2">
                        <Label htmlFor={`terminal-auth-${prompt.request_id}-password`} className="text-foreground">
                          {tTerminal("authRetryPasswordLabel")}
                        </Label>
                        <div className="relative">
                          <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            ref={credentialFields[0] === "password" ? firstInputRef : undefined}
                            id={`terminal-auth-${prompt.request_id}-password`}
                            type="password"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            autoComplete="current-password"
                            required
                            className="pl-10"
                          />
                        </div>
                      </div>
                    ) : (
                      <PrivateKeyCredentialInput
                        key="key"
                        id={`terminal-auth-${prompt.request_id}-private-key`}
                        value={privateKey}
                        onChange={setPrivateKey}
                        label={tTerminal("authRetryPrivateKeyLabel")}
                        placeholder={tTerminal("authRetryPrivateKeyPlaceholder")}
                        refCallback={credentialFields[0] === "key" ? firstTextAreaRef : undefined}
                      />
                    )
                  ))
                ) : prompts.map((item, index) => {
                  const inputId = `terminal-auth-${prompt.request_id}-${index}`

                  return (
                    <div key={`${prompt.request_id}-${index}`} className="space-y-2">
                      <Label htmlFor={inputId} className="text-foreground">
                        {item.text || tTerminal("authChallengePromptFallback", { index: index + 1 })}
                      </Label>
                      <div className="relative">
                        <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          ref={index === 0 ? firstInputRef : undefined}
                          id={inputId}
                          type={item.echo ? "text" : "password"}
                          value={answers[index] ?? ""}
                          onChange={(event) => updateAnswer(index, event.target.value)}
                          autoComplete={getAutocomplete(item.text, item.echo)}
                          className="pl-10"
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <DialogFooter className="gap-2 px-6 py-4">
              <Button type="button" variant="outline" onClick={onCancel}>
                {tTerminal("authChallengeCancel")}
              </Button>
              <Button type="submit">
                {isCredentialRetry
                  ? tTerminal("authRetrySubmit")
                  : isPrivateKeyPassphrase
                    ? tTerminal("authPassphraseSubmit")
                    : tTerminal("authChallengeSubmit")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

function PrivateKeyCredentialInput({
  id,
  value,
  onChange,
  label,
  placeholder,
  refCallback,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  label: string
  placeholder: string
  refCallback?: RefObject<HTMLTextAreaElement | null>
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-foreground">
        {label}
      </Label>
      <Textarea
        ref={refCallback}
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={8}
        required
        className="font-mono text-sm"
      />
    </div>
  )
}
