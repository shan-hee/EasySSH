"use client"

import { useTranslation } from "react-i18next"

import { memo, useState, type FC, type ReactNode } from "react"
import { CheckIcon, CopyIcon } from "lucide-react"
import {
  toolApprovalAcceptsText,
  useToolCallElapsed,
  type ToolApprovalOption,
  type ToolCallMessagePart,
  type ToolCallMessagePartProps,
  type ToolCallMessagePartStatus
} from "@assistant-ui/react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

import { TooltipIconButton } from "./tooltip-icon-button"
import { ToolCall } from "./tool-call"
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard"

const formatToolDuration = (ms: number) => {
  if (ms < 1000) return "<1s"
  const seconds = ms / 1000
  if (seconds < 10) return `${(Math.floor(seconds * 10) / 10).toFixed(1)}s`
  if (seconds < 60) return `${Math.floor(seconds)}s`
  return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`
}

function ToolFallbackDuration({ className, ...props }: React.ComponentProps<"span">) {
  const elapsedMs = useToolCallElapsed()
  if (elapsedMs === undefined) return null

  return (
    <span
      data-slot="tool-fallback-duration"
      className={cn(
        "aui-tool-fallback-duration text-muted-foreground text-xs tabular-nums",
        className
      )}
      {...props}
    >
      {formatToolDuration(elapsedMs)}
    </span>
  )
}

function ToolOutputCopy({ value }: { value: string }) {
  const { t } = useTranslation("aiAssistant")
  const { isCopied, copyToClipboard } = useCopyToClipboard()
  const [error, setError] = useState("")
  return (
    <>
      <TooltipIconButton
        className="absolute end-1 top-1 z-10 bg-background/80"
        tooltip={t(isCopied ? "copied" : "copy")}
        onClick={() => {
          setError("")
          void copyToClipboard(value).catch((cause) => setError(String(cause)))
        }}
      >
        {isCopied ? <CheckIcon /> : <CopyIcon />}
      </TooltipIconButton>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </>
  )
}

function ToolFallbackArgs({
  argsText,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  argsText?: string
}) {
  const { t } = useTranslation("aiAssistant")
  if (!argsText) return null

  return (
    <div
      data-slot="tool-fallback-args"
      className={cn("aui-tool-fallback-args relative min-w-0", className)}
      {...props}
    >
      <p className="mb-1 text-xs font-medium text-muted-foreground">{t("auiToolRequest")}</p>
      <ToolOutputCopy value={argsText} />
      <pre className="aui-tool-fallback-args-value bg-muted/50 text-foreground/90 max-h-96 overflow-auto rounded-md p-2.5 pe-9 text-xs whitespace-pre-wrap break-words">
        {argsText}
      </pre>
    </div>
  )
}

function ToolFallbackResult({
  result,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  result?: unknown
}) {
  const { t } = useTranslation("aiAssistant")
  if (result === undefined) return null

  return (
    <div
      data-slot="tool-fallback-result"
      className={cn("aui-tool-fallback-result relative min-w-0", className)}
      {...props}
    >
      <p className="aui-tool-fallback-result-header text-muted-foreground text-xs font-medium">
        {t("taskResult")}:
      </p>
      <ToolOutputCopy
        value={typeof result === "string" ? result : JSON.stringify(result, null, 2)}
      />
      <pre className="aui-tool-fallback-result-content bg-muted/50 text-foreground/90 mt-1 max-h-96 overflow-auto rounded-md p-2.5 pe-9 text-xs whitespace-pre-wrap break-words">
        {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
      </pre>
    </div>
  )
}

function ToolFallbackError({
  status,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  status?: ToolCallMessagePartStatus
}) {
  const { t } = useTranslation("aiAssistant")
  if (status?.type !== "incomplete") return null

  const error = status.error
  const errorText = error ? (typeof error === "string" ? error : JSON.stringify(error)) : null

  if (!errorText) return null

  const isCancelled = status.reason === "cancelled"
  const headerText = t(isCancelled ? "auiCancelledReason" : "auiError")

  return (
    <div
      data-slot="tool-fallback-error"
      className={cn("aui-tool-fallback-error", className)}
      {...props}
    >
      <p className="aui-tool-fallback-error-header text-muted-foreground font-semibold">
        {headerText}
      </p>
      <p className="aui-tool-fallback-error-reason text-muted-foreground">{errorText}</p>
    </div>
  )
}

const APPROVED_RESULT = "Approved by user"
const DENIED_RESULT = "User denied tool execution"

const APPROVAL_OPTION_DEFAULT_LABELS: Record<string, string> = {
  "allow-once": "auiAllow",
  "allow-always": "auiAlwaysAllow",
  "reject-once": "auiDeny",
  "reject-always": "auiAlwaysDeny"
}

const isKnownKind = (kind: string) => Object.hasOwn(APPROVAL_OPTION_DEFAULT_LABELS, kind)

const isAllowKind = (kind: string) => kind === "allow-once" || kind === "allow-always"

/**
 * A request that declares how it wants to be presented is asking a question,
 * not gating an action, so a refusal is not one of the answers it accepts.
 */
const isQuestion = (approval: ToolCallMessagePart["approval"]) =>
  approval?.display === "select" || approval?.display === "text"

const offersInterruptAction = (
  status: ToolCallMessagePartStatus | undefined,
  approval: ToolCallMessagePart["approval"],
  interrupt: ToolCallMessagePart["interrupt"]
) =>
  status?.type !== "requires-action" ||
  status.reason !== "interrupt" ||
  approval != null ||
  interrupt != null

function ToolFallbackApproval({
  className,
  addResult,
  resume,
  interrupt,
  approval,
  respondToApproval,
  status,
  disabled = false,
  ...props
}: React.ComponentProps<"div"> & { disabled?: boolean } & Partial<
    Pick<ToolCallMessagePartProps, "addResult" | "resume" | "respondToApproval" | "status">
  > & {
    interrupt?: ToolCallMessagePart["interrupt"]
    approval?: ToolCallMessagePart["approval"]
  }) {
  const { t } = useTranslation("aiAssistant")
  const approvalOptionLabel = (option: ToolApprovalOption) =>
    option.label ??
    (isKnownKind(option.kind) ? t(APPROVAL_OPTION_DEFAULT_LABELS[option.kind]) : option.id)
  const [submitted, setSubmitted] = useState(false)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [answer, setAnswer] = useState("")
  const [error, setError] = useState<string | null>(null)

  if (approval != null && (approval.approved !== undefined || approval.resolution !== undefined))
    return null

  if (!offersInterruptAction(status, approval, interrupt)) return null

  // A declared option list is a host constraint: the kit never adds an
  // approval path beyond it, and preserves a refusal path only where the
  // request is an action the user may refuse.
  const declaredOptions = respondToApproval ? approval?.options : undefined
  const acceptsText =
    approval != null && respondToApproval != null && toolApprovalAcceptsText(approval)

  // A refused response leaves the request open, so the controls come back
  // rather than staying spent on a decision the runtime never recorded.
  const submit = (send: () => Promise<void> | void) => {
    setSubmitted(true)
    setError(null)
    void (async () => {
      try {
        await send()
      } catch (sendError) {
        setSubmitted(false)
        setError(sendError instanceof Error ? sendError.message : String(sendError))
      }
    })()
  }

  const respond = (approved: boolean) => {
    if (submitted || disabled) return
    if (approval != null && approval.approved === undefined && respondToApproval) {
      submit(() => respondToApproval({ approved, ...typedAnswer() }))
    } else if (interrupt) {
      submit(() => resume?.({ approved }))
    } else if (status?.type === "requires-action" && status.reason === "interrupt") {
      return
    } else {
      submit(() => addResult?.(approved ? APPROVED_RESULT : DENIED_RESULT))
    }
  }

  const respondWithOption = (option: ToolApprovalOption) => {
    if (submitted || disabled) return
    setConfirmingId(null)
    // A custom kind has no decision class for the runtime to derive, and
    // responding without one throws; picking a declared option is an answer,
    // so it resolves as approved.
    submit(() =>
      respondToApproval?.(
        isKnownKind(option.kind)
          ? { optionId: option.id, ...typedAnswer() }
          : { optionId: option.id, approved: true, ...typedAnswer() }
      )
    )
  }

  const typedAnswer = () => (answer.trim() ? { text: answer } : {})

  const submitAnswer = () => {
    if (submitted || disabled || !answer.trim()) return
    submit(() => respondToApproval?.({ text: answer }))
  }

  const handleOption = (option: ToolApprovalOption) => {
    if (option.confirm) {
      setConfirmingId(option.id)
    } else {
      respondWithOption(option)
    }
  }

  const confirming =
    confirmingId != null ? declaredOptions?.find((o) => o.id === confirmingId) : undefined

  const question = isQuestion(approval)

  const promptText = approval?.prompt ? (
    <p className="aui-tool-fallback-approval-prompt text-foreground">{approval.prompt}</p>
  ) : null

  const errorText = error ? (
    <p role="alert" className="aui-tool-fallback-approval-error text-destructive text-xs">
      {error}
    </p>
  ) : null

  const answerField = acceptsText ? (
    <div className="aui-tool-fallback-approval-answer flex flex-col items-start gap-2">
      <Textarea
        value={answer}
        onChange={(event) => setAnswer(event.target.value)}
        disabled={submitted || disabled}
        aria-label={question ? (approval?.prompt ?? t("auiAnswer")) : t("auiNote")}
        placeholder={t(question ? "auiTypeAnswer" : "auiDecisionNote")}
      />
      {question && (
        <Button size="sm" onClick={submitAnswer} disabled={submitted || disabled || !answer.trim()}>
          {t("send")}
        </Button>
      )}
    </div>
  ) : null

  if (confirming) {
    const confirmMeta = typeof confirming.confirm === "object" ? confirming.confirm : undefined
    const confirmDescription = confirmMeta?.description ?? confirming.description
    return (
      <div
        data-slot="tool-fallback-approval-confirm"
        className={cn("aui-tool-fallback-approval-confirm flex flex-col gap-2 pt-1", className)}
        {...props}
      >
        <p className="aui-tool-fallback-approval-confirm-title font-semibold">
          {confirmMeta?.title ?? `${approvalOptionLabel(confirming)}?`}
        </p>
        {confirmDescription && (
          <p className="aui-tool-fallback-approval-confirm-description text-muted-foreground">
            {confirmDescription}
          </p>
        )}
        {confirming.grants && confirming.grants.length > 0 && (
          <ul className="aui-tool-fallback-approval-confirm-grants flex flex-col gap-1">
            {confirming.grants.map((grant) => (
              <li key={grant}>
                <code className="aui-tool-fallback-approval-confirm-grant bg-muted rounded px-1.5 py-0.5 text-xs">
                  {grant}
                </code>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => respondWithOption(confirming)}
            disabled={submitted || disabled}
          >
            {t("confirmAction")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setConfirmingId(null)}
            disabled={submitted || disabled}
          >
            {t("auiBack")}
          </Button>
        </div>
      </div>
    )
  }

  if (declaredOptions && declaredOptions.length > 0) {
    const allowOptions = declaredOptions.filter((o) => isAllowKind(o.kind))
    const customOptions = declaredOptions.filter((o) => !isKnownKind(o.kind))
    const rejectOptions = declaredOptions.filter((o) => isKnownKind(o.kind) && !isAllowKind(o.kind))
    return (
      <div
        data-slot="tool-fallback-approval"
        className={cn("aui-tool-fallback-approval flex flex-col gap-2 pt-1", className)}
        {...props}
      >
        {promptText}
        <div className="flex flex-wrap items-center gap-2">
          {[...allowOptions, ...customOptions, ...rejectOptions].map((option) => (
            <Button
              key={option.id}
              size="sm"
              variant={option === allowOptions[0] ? "default" : "outline"}
              onClick={() => handleOption(option)}
              disabled={submitted || disabled}
            >
              {approvalOptionLabel(option)}
            </Button>
          ))}
          {rejectOptions.length === 0 && !question && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => respond(false)}
              disabled={submitted || disabled}
            >
              {t("auiDeny")}
            </Button>
          )}
        </div>
        {answerField}
        {errorText}
      </div>
    )
  }

  // A question carries no decision to fabricate, so it renders only what the
  // request declared, even when that leaves nothing to act on here.
  if (question) {
    return (
      <div
        data-slot="tool-fallback-approval"
        className={cn("aui-tool-fallback-approval flex flex-col gap-2 pt-1", className)}
        {...props}
      >
        {promptText}
        {answerField}
        {errorText}
      </div>
    )
  }

  return (
    <div
      data-slot="tool-fallback-approval"
      className={cn("aui-tool-fallback-approval flex flex-col gap-2 pt-1", className)}
      {...props}
    >
      {promptText}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => respond(true)} disabled={submitted || disabled}>
          {t("auiAllow")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => respond(false)}
          disabled={submitted || disabled}
        >
          {t("auiDeny")}
        </Button>
      </div>
      {answerField}
      {errorText}
    </div>
  )
}

type ToolFallbackProps = ToolCallMessagePartProps & { children?: ReactNode; disabled?: boolean }

const ToolFallbackImpl: FC<ToolFallbackProps> = ({
  toolName,
  args,
  providerMetadata,
  argsText,
  result,
  status,
  addResult,
  resume,
  interrupt,
  approval,
  respondToApproval,
  children,
  disabled
}) => {
  const isCancelled =
    providerMetadata?.easyssh?.taskStatus === "cancelled" ||
    (status?.type === "incomplete" && status.reason === "cancelled")
  const isRequiresAction = status?.type === "requires-action"
  const shouldRenderApproval =
    isRequiresAction && offersInterruptAction(status, approval, interrupt)

  const [open, setOpen] = useState(isRequiresAction)
  const [prevRequiresAction, setPrevRequiresAction] = useState(isRequiresAction)
  if (isRequiresAction !== prevRequiresAction) {
    setPrevRequiresAction(isRequiresAction)
    if (isRequiresAction) setOpen(true)
  }

  const { t } = useTranslation("aiAssistant")
  const state = isCancelled
    ? "cancelled"
    : isRequiresAction
      ? "approval"
      : status?.type === "running"
        ? "running"
        : status?.type === "incomplete"
          ? "error"
          : "complete"
  const query = [args.command, args.path, args.host, args.server_name].find(
    (value) => typeof value === "string"
  ) as string | undefined
  const label = `${t(state === "running" ? "auiToolRunning" : state === "approval" ? "auiToolApproval" : state === "error" ? "auiToolFailed" : state === "cancelled" ? "auiCancelledTool" : "auiUsedTool")}: ${toolName}`
  return (
    <ToolCall
      label={label}
      query={query}
      state={state}
      open={open}
      onOpenChange={setOpen}
      timing={<ToolFallbackDuration />}
    >
      <ToolFallbackError status={status} />
      <ToolFallbackArgs argsText={argsText} className={cn(isCancelled && "opacity-60")} />
      {children}
      {shouldRenderApproval && (
        <ToolFallbackApproval
          disabled={disabled}
          addResult={addResult}
          resume={resume}
          interrupt={interrupt}
          approval={approval}
          respondToApproval={respondToApproval}
          status={status}
        />
      )}
      {!isCancelled && <ToolFallbackResult result={result} />}
    </ToolCall>
  )
}

const ToolFallback = memo(ToolFallbackImpl)
ToolFallback.displayName = "ToolFallback"

export { ToolFallback }
