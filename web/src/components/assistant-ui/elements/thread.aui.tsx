"use client"

import { Slot } from "@radix-ui/react-slot"
import { useActionBarCopy } from "@assistant-ui/core/react"
import { writeClipboardText } from "@/lib/clipboard"

import { UserMessageAttachments } from "@/components/assistant-ui/elements/attachment.aui"
import { File } from "@/components/assistant-ui/elements/file"
import { Image } from "@/components/assistant-ui/elements/image"
import { MarkdownText } from "@/components/assistant-ui/elements/markdown-text"
import {
  Reasoning,
  ReasoningContent,
  ReasoningRoot,
  ReasoningText,
  ReasoningTrigger
} from "@/components/assistant-ui/elements/reasoning.aui"
import { ToolFallback } from "@/components/assistant-ui/elements/tool-fallback.aui"
import { ToolTimeline } from "./tool-timeline"
import { MessagePair } from "./message-pair"
import { MessageTimestamp } from "./timeline"
import { StoppedRun } from "./stopped-run"
import { TooltipIconButton } from "@/components/assistant-ui/elements/tooltip-icon-button"
import { Button } from "@/components/ui/button"
import { Sources } from "./sources.aui"
import { ThinkingIndicator } from "./thinking-indicator"
import { MessageTiming } from "./message-timing.aui"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import {
  ActionBarMorePrimitive,
  ActionBarPrimitive,
  AuiIf,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  groupPartByType,
  MessagePrimitive,
  ThreadPrimitive,
  type FileMessagePartComponent,
  type ImageMessagePartComponent,
  type ToolCallMessagePartComponent,
  type TextMessagePartComponent,
  useAuiState,
  useAui
} from "@assistant-ui/react"
import {
  ArrowDownIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
  ThumbsUpIcon,
  ThumbsDownIcon,
  Volume2Icon,
  SquareIcon,
  Trash2Icon
} from "lucide-react"
import {
  createContext,
  useContext,
  useState,
  useRef,
  useMemo,
  type ComponentType,
  type FC,
  type ReactNode,
  type PropsWithChildren
} from "react"

export type ThreadGroupPart = MessagePrimitive.GroupedParts.GroupPart

/**
 * Optional component overrides for the thread. `AssistantMessage` and
 * `Welcome` replace whole sections; the remaining slots override how the
 * assistant message renders tool calls and part groups. Tool UIs registered
 * by name (toolkit `render`, `useAssistantDataUI`) take precedence over
 * `ToolFallback`.
 */
export type ThreadComponents = {
  UserText?: TextMessagePartComponent | undefined
  EditComposer?: ComponentType | undefined
  AssistantMessage?: ComponentType | undefined
  Welcome?: ComponentType | undefined
  ToolFallback?: ToolCallMessagePartComponent | undefined
  Data?: ComponentType<{ name: string; data: unknown }> | undefined
  ToolGroup?: ComponentType<PropsWithChildren<{ group: ThreadGroupPart }>> | undefined
  ReasoningGroup?: ComponentType<PropsWithChildren<{ group: ThreadGroupPart }>> | undefined
}

export type ThreadProps = {
  components?: ThreadComponents
  className?: string
  contentClassName?: string
  emptyDescription?: string
  loadingText?: string
  compact?: boolean
  onUpdateUserMessage?: (id: string, text: string) => boolean | Promise<boolean>
  onRegenerateUserMessage?: (id: string, text: string) => boolean | Promise<boolean>
  onDeleteUserMessage?: (id: string) => boolean | Promise<boolean>
  onContinueStoppedRun?: (id: string) => boolean | Promise<boolean>
}

const ThreadComponentsContext = createContext<ThreadComponents>({})
const ThreadOptionsContext = createContext<Omit<ThreadProps, "components">>({})
const MESSAGE_BATCH = 50

export const Thread: FC<ThreadProps> = ({ components = {}, ...options }) => {
  const { t } = useTranslation("aiAssistant")
  const messages = useAuiState((s) => s.thread.messages)
  const count = messages.length
  const hasRunningAssistant = useAuiState((s) => {
    const last = s.thread.messages[s.thread.messages.length - 1]
    return last?.role === "assistant" && last.status.type === "running"
  })
  const [visibleCount, setVisibleCount] = useState(MESSAGE_BATCH)
  const pairs = useMemo(() => {
    const groups: { id: string; indices: number[] }[] = []
    messages.forEach((message, index) => {
      if (message.role === "system") return
      if (message.role === "user" || groups.length === 0)
        groups.push({ id: message.id, indices: [] })
      groups[groups.length - 1]!.indices.push(index)
    })
    return groups.filter(
      (group) => group.indices[group.indices.length - 1]! >= Math.max(0, count - visibleCount)
    )
  }, [count, messages, visibleCount])
  const hidden = pairs[0]?.indices[0] ?? 0
  const { className, contentClassName, loadingText, compact } = options
  const { Welcome = ThreadWelcome } = components
  return (
    <ThreadOptionsContext.Provider value={options}>
      <ThreadComponentsContext.Provider value={components}>
        <ThreadPrimitive.Root
          className={cn(
            "aui-root aui-thread-root relative flex min-h-0 min-w-0 flex-1 flex-col",
            compact && "text-xs",
            className
          )}
          style={
            {
              "--composer-bg": "var(--color-card)",
              "--composer-radius": "calc(var(--radius) + 12px)",
              "--composer-padding": "8px"
            } as React.CSSProperties
          }
        >
          <ThreadPrimitive.Viewport
            autoScroll
            className="scrollbar-custom relative flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable]"
          >
            <div
              role="log"
              aria-label={t("panelAriaHistoryLabel")}
              className={cn(
                "mx-auto flex min-h-full w-full flex-col gap-6 px-4 py-4",
                contentClassName
              )}
            >
              {hidden > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mx-auto"
                  onClick={() => setVisibleCount((n) => n + MESSAGE_BATCH)}
                >
                  {t("loadEarlierMessages", { count: hidden })}
                </Button>
              )}
              {count === 0 && !loadingText && <Welcome />}
              {pairs.map((pair, index) => (
                <MessagePair key={pair.id}>
                  {pair.indices.map((messageIndex) => (
                    <ThreadPrimitive.MessageByIndex
                      key={messages[messageIndex]!.id}
                      index={messageIndex}
                      components={{ Message: ThreadMessage, EditComposer: ThreadMessage }}
                    />
                  ))}
                  {index === pairs.length - 1 && loadingText && !hasRunningAssistant && (
                    <ThinkingIndicator label={loadingText} className="px-2 py-1" />
                  )}
                </MessagePair>
              ))}
              {pairs.length === 0 && loadingText && (
                <ThinkingIndicator label={loadingText} className="px-2 py-1" />
              )}
            </div>
            <ThreadScrollToBottom />
          </ThreadPrimitive.Viewport>
        </ThreadPrimitive.Root>
      </ThreadComponentsContext.Provider>
    </ThreadOptionsContext.Provider>
  )
}

const ThreadMessage: FC = () => {
  const { AssistantMessage: AssistantMessageComponent = AssistantMessage } =
    useContext(ThreadComponentsContext)
  const role = useAuiState((s) => s.message.role)
  const isEditing = useAuiState((s) => s.message.composer.isEditing)

  const { EditComposer: EditComposerComponent = MessageEditComposer } = useContext(ThreadComponentsContext)
  if (role === "system") return null
  if (isEditing) return <EditComposerComponent />
  if (role === "user") return <UserMessage />
  return <AssistantMessageComponent />
}

const ThreadScrollToBottom: FC = () => {
  const { t } = useTranslation("aiAssistant")
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip={t("scrollToBottom")}
        variant="outline"
        className="aui-thread-scroll-to-bottom dark:border-border dark:bg-background dark:hover:bg-accent terminal-ai-glass-control sticky bottom-3 z-10 self-center rounded-full p-4 disabled:hidden"
      >
        <ArrowDownIcon />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  )
}

const ThreadWelcome: FC = () => {
  const { t } = useTranslation("aiAssistant")
  const { emptyDescription } = useContext(ThreadOptionsContext)
  return (
    <div className="aui-thread-welcome-root flex flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">
      {emptyDescription || t("emptyDescriptionIntro")}
    </div>
  )
}

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="aui-message-error-root border-destructive bg-destructive/10 text-destructive dark:bg-destructive/5 mt-2 rounded-md border p-3 text-sm">
        <ErrorPrimitive.Message className="aui-message-error-message line-clamp-2" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  )
}

const AssistantMessage: FC = () => {
  const { t } = useTranslation("aiAssistant")
  const { loadingText } = useContext(ThreadOptionsContext)
  const {
    ToolFallback: ToolFallbackComponent = ToolFallback,
    ToolGroup,
    ReasoningGroup,
    Data
  } = useContext(ThreadComponentsContext)

  const ACTION_BAR_PT = "pt-1.5"
  // Keep the action bar inside the contained root's paint box, then cancel its reserved space in flow.
  const ACTION_BAR_HEIGHT = `min-h-7.5 ${ACTION_BAR_PT}`

  return (
    <MessagePrimitive.Root
      data-slot="aui_assistant-message-root"
      data-role="assistant"
      className="fade-in slide-in-from-bottom-1 animate-in relative -mb-7.5 pb-7.5 duration-150 [contain-intrinsic-size:auto_200px] [content-visibility:auto]"
    >
      <div
        data-slot="aui_assistant-message-content"
        className="agent-message-content min-w-0 text-foreground px-2 text-sm leading-relaxed wrap-break-word"
      >
        <MessagePrimitive.GroupedParts
          groupBy={groupPartByType({
            reasoning: ["group-chainOfThought", "group-reasoning"],
            "tool-call": ["group-chainOfThought", "group-tool"],
            "standalone-tool-call": []
          })}
        >
          {({ part, children }) => {
            switch (part.type) {
              case "group-chainOfThought":
                return <div data-slot="aui_chain-of-thought">{children}</div>
              case "group-tool":
                if (ToolGroup) {
                  return <ToolGroup group={part}>{children}</ToolGroup>
                }
                return <ThreadToolGroup group={part}>{children}</ThreadToolGroup>
              case "group-reasoning": {
                if (ReasoningGroup) {
                  return <ReasoningGroup group={part}>{children}</ReasoningGroup>
                }
                const running = part.status.type === "running"
                return (
                  <ReasoningRoot streaming={running}>
                    <ReasoningTrigger active={running} />
                    <ReasoningContent aria-busy={running}>
                      <ReasoningText>{children}</ReasoningText>
                    </ReasoningContent>
                  </ReasoningRoot>
                )
              }
              case "text":
                return <MarkdownText />
              case "reasoning":
                return <Reasoning {...part} />
              case "tool-call":
                return part.toolUI ?? <ToolFallbackComponent {...part} />
              case "data":
                if (part.name === "stopped-run") return <StoppedRunMessage data={part.data} />
                return (
                  part.dataRendererUI ?? (Data ? <Data name={part.name} data={part.data} /> : null)
                )
              case "source":
                return <Sources {...part} />
              case "file":
                return (
                  <div data-slot="aui_assistant-message-file" className="py-1">
                    <File {...part} />
                  </div>
                )
              case "image":
                return (
                  <div data-slot="aui_assistant-message-image" className="py-1">
                    <Image {...part} />
                  </div>
                )
              case "indicator":
                return (
                  <ThinkingIndicator
                    data-slot="aui_assistant-message-indicator"
                    label={loadingText || t("auiThinking")}
                    className="py-1"
                  />
                )
              default:
                return null
            }
          }}
        </MessagePrimitive.GroupedParts>
        <MessageError />
      </div>

      <div
        data-slot="aui_assistant-message-footer"
        className={cn("ms-2 flex items-center", ACTION_BAR_HEIGHT)}
      >
        <BranchPicker />
        <AssistantActionBar />
      </div>
    </MessagePrimitive.Root>
  )
}

function ThreadToolGroup({ group, children }: PropsWithChildren<{ group: ThreadGroupPart }>) {
  const waiting = useAuiState((s) =>
    group.indices.some((i) => {
      const part = s.message.content[i]
      return (
        part?.type === "tool-call" &&
        part.approval != null &&
        part.approval.approved === undefined &&
        !part.approval.resolution
      )
    })
  )
  const [open, setOpen] = useState(false)
  return (
    <ToolTimeline
      count={group.indices.length}
      active={group.status.type === "running"}
      open={waiting || open}
      onOpenChange={setOpen}
    >
      {children}
    </ToolTimeline>
  )
}

function StoppedRunMessage({ data }: { data: unknown }) {
  const { onContinueStoppedRun, onDeleteUserMessage } = useContext(ThreadOptionsContext)
  const disabled = useAuiState((s) => s.thread.isRunning || !s.message.isLast)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const lock = useRef(false)
  if (
    !data ||
    typeof data !== "object" ||
    !("messageId" in data) ||
    !("stoppedAt" in data) ||
    typeof data.messageId !== "string" ||
    typeof data.stoppedAt !== "string"
  )
    return null
  const id = data.messageId
  const act = async (action: ((id: string) => boolean | Promise<boolean>) | undefined) => {
    if (!action || disabled || lock.current) return
    lock.current = true
    setBusy(true)
    setError("")
    try {
      await action(id)
    } catch (cause) {
      setError(String(cause))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <StoppedRun
      stoppedAt={data.stoppedAt}
      disabled={disabled || busy || !onContinueStoppedRun || !onDeleteUserMessage}
      onContinue={() => void act(onContinueStoppedRun)}
      onDiscard={() => void act(onDeleteUserMessage)}
      error={error}
    />
  )
}

function CurrentMessageTimestamp() {
  const value = useAuiState((s) => s.message.metadata.custom?.createdAt)
  return <MessageTimestamp value={typeof value === "string" ? value : undefined} />
}

function MessageCopyButton({ children }: { children: React.ReactElement }) {
  const { copy, disabled } = useActionBarCopy({ copyToClipboard: writeClipboardText })
  return (
    <Slot onClick={disabled ? undefined : copy} aria-disabled={disabled}>
      {children}
    </Slot>
  )
}

const AssistantActionBar: FC = () => {
  const { t } = useTranslation("aiAssistant")
  const { onRegenerateUserMessage } = useContext(ThreadOptionsContext)
  const parent = useAuiState((s) =>
    s.thread.messages
      .slice(
        0,
        s.thread.messages.findIndex((message) => message.id === s.message.id)
      )
      .reverse()
      .find((message) => message.role === "user")
  )
  const [regenerating, setRegenerating] = useState(false)
  const [regenerateError, setRegenerateError] = useState("")
  const regenerateLock = useRef(false)
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-assistant-action-bar-root text-muted-foreground animate-in fade-in col-start-3 row-start-2 -ms-1 flex flex-wrap items-center gap-1 duration-200"
    >
      <MessageCopyButton>
        <TooltipIconButton tooltip={t("copy")}>
          <AuiIf condition={(s) => s.message.isCopied}>
            <CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out" />
          </AuiIf>
          <AuiIf condition={(s) => !s.message.isCopied}>
            <CopyIcon className="animate-in zoom-in-75 fade-in duration-150" />
          </AuiIf>
        </TooltipIconButton>
      </MessageCopyButton>
      <ActionBarPrimitive.FeedbackPositive asChild>
        <TooltipIconButton
          tooltip={t("auiLike")}
          className="data-submitted:bg-accent data-submitted:text-foreground"
        >
          <ThumbsUpIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.FeedbackPositive>
      <ActionBarPrimitive.FeedbackNegative asChild>
        <TooltipIconButton
          tooltip={t("auiDislike")}
          className="data-submitted:bg-accent data-submitted:text-foreground"
        >
          <ThumbsDownIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.FeedbackNegative>
      <AuiIf condition={(s) => !s.message.speech || s.message.speech.status.type !== "running"}>
        <ActionBarPrimitive.Speak asChild>
          <TooltipIconButton tooltip={t("auiReadAloud")}>
            <Volume2Icon />
          </TooltipIconButton>
        </ActionBarPrimitive.Speak>
      </AuiIf>
      <AuiIf condition={(s) => s.message.speech?.status.type === "running"}>
        <ActionBarPrimitive.StopSpeaking asChild>
          <TooltipIconButton tooltip={t("auiStopReading")}>
            <SquareIcon />
          </TooltipIconButton>
        </ActionBarPrimitive.StopSpeaking>
      </AuiIf>
      <ActionBarPrimitive.Reload
        asChild
        disabled={!parent || !onRegenerateUserMessage || regenerating}
        onClick={(event) => {
          // The host owns persistence and execution context. Prevent the default local branch operation.
          event.preventDefault()
          if (!parent || !onRegenerateUserMessage || regenerateLock.current) return
          regenerateLock.current = true
          setRegenerating(true)
          setRegenerateError("")
          const content = parent.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n")
          void Promise.resolve()
            .then(() => onRegenerateUserMessage(parent.id, content))
            .catch((cause) => setRegenerateError(String(cause)))
            .finally(() => {
              regenerateLock.current = false
              setRegenerating(false)
            })
        }}
      >
        <TooltipIconButton tooltip={t("regenerate")}>
          <RefreshCwIcon className={regenerating ? "animate-spin" : undefined} />
        </TooltipIconButton>
      </ActionBarPrimitive.Reload>
      <ActionBarMorePrimitive.Root>
        <ActionBarMorePrimitive.Trigger asChild>
          <TooltipIconButton tooltip={t("moreActions")} className="data-[state=open]:bg-accent">
            <MoreHorizontalIcon />
          </TooltipIconButton>
        </ActionBarMorePrimitive.Trigger>
        <ActionBarMorePrimitive.Content
          side="bottom"
          align="start"
          sideOffset={6}
          className="aui-action-bar-more-content bg-popover text-popover-foreground data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:animate-out data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] overflow-hidden rounded-xl border p-1.5"
        >
          <ActionBarPrimitive.ExportMarkdown asChild>
            <ActionBarMorePrimitive.Item className="aui-action-bar-more-item hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none">
              <DownloadIcon className="size-4" />
              {t("exportMarkdown")}
            </ActionBarMorePrimitive.Item>
          </ActionBarPrimitive.ExportMarkdown>
        </ActionBarMorePrimitive.Content>
      </ActionBarMorePrimitive.Root>
      <MessageTiming />
      <CurrentMessageTimestamp />
      {regenerateError && (
        <span role="alert" className="basis-full text-xs text-destructive">
          {regenerateError}
        </span>
      )}
    </ActionBarPrimitive.Root>
  )
}

const UserFilePart: FileMessagePartComponent = (part) => (
  <div data-slot="aui_user-message-file" className="py-1">
    <File {...part} />
  </div>
)

const UserImagePart: ImageMessagePartComponent = (part) => (
  <div data-slot="aui_user-message-image" className="py-1">
    <Image {...part} />
  </div>
)

const UserMessage: FC = () => {
  const { UserText } = useContext(ThreadComponentsContext)
  return (
    <MessagePrimitive.Root
      data-slot="aui_user-message-root"
      className="fade-in slide-in-from-bottom-1 animate-in grid auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 duration-150 [contain-intrinsic-size:auto_200px] [content-visibility:auto] [&:where(>*)]:col-start-2"
      data-role="user"
    >
      <UserMessageAttachments />

      <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
        <div className="agent-message-content aui-user-message-content peer ms-auto w-fit max-w-full border border-border/60 bg-background text-foreground dark:bg-popover rounded-2xl px-3.5 py-2 wrap-break-word empty:hidden">
          <MessagePrimitive.Parts components={{ File: UserFilePart, Image: UserImagePart, ...(UserText ? { Text: UserText } : {}) }} />
        </div>
        <div className="aui-user-action-bar-wrapper mt-1 flex min-h-6 justify-end peer-empty:hidden">
          <UserActionBar />
        </div>
      </div>

      <BranchPicker
        data-slot="aui_user-branch-picker"
        className="col-span-full col-start-1 row-start-3 -me-1 justify-end"
      />
    </MessagePrimitive.Root>
  )
}

const UserActionBar: FC = () => {
  const { t } = useTranslation("aiAssistant")
  const { onUpdateUserMessage, onDeleteUserMessage } = useContext(ThreadOptionsContext)
  const id = useAuiState((s) => s.message.id)
  const running = useAuiState((s) => s.thread.isRunning)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-user-action-bar-root flex flex-wrap items-center justify-end gap-1 text-muted-foreground"
    >
      <CurrentMessageTimestamp />
      {onUpdateUserMessage && (
        <ActionBarPrimitive.Edit asChild>
          <TooltipIconButton tooltip={t("edit")} disabled={busy || running}>
            <PencilIcon />
          </TooltipIconButton>
        </ActionBarPrimitive.Edit>
      )}
      <MessageCopyButton>
        <TooltipIconButton tooltip={t("copy")}>
          <CopyIcon />
        </TooltipIconButton>
      </MessageCopyButton>
      {onDeleteUserMessage && (
        <TooltipIconButton
          tooltip={t("delete")}
          disabled={busy || running}
          onClick={async () => {
            setBusy(true)
            setError("")
            try {
              await onDeleteUserMessage(id)
            } catch (cause) {
              setError(String(cause))
            } finally {
              setBusy(false)
            }
          }}
        >
          <Trash2Icon />
        </TooltipIconButton>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </ActionBarPrimitive.Root>
  )
}

export const MessageEditComposer: FC<{ onSave?: (id: string, text: string) => boolean | Promise<boolean>; children?: ReactNode | ((disabled: boolean) => ReactNode); renderInput?: (disabled: boolean) => ReactNode }> = ({ onSave, children, renderInput }) => {
  const { t } = useTranslation("aiAssistant")
  const { onUpdateUserMessage } = useContext(ThreadOptionsContext)
  const save = onSave ?? onUpdateUserMessage
  const aui = useAui()
  const id = useAuiState((s) => s.message.id)
  const running = useAuiState((s) => s.thread.isRunning)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  return (
    <MessagePrimitive.Root
      data-slot="aui_edit-composer-wrapper"
      className="flex flex-col px-2"
    >
      <ComposerPrimitive.Unstable_TriggerPopoverRoot>
        <ComposerPrimitive.Root
          onSubmit={(event) => {
            event.preventDefault()
            const text = aui.composer.getState().text.trim()
            if (!text || busy || running || !save) return
            setBusy(true)
            setError("")
            void (async () => {
              try {
                if (await save(id, text)) aui.composer.cancel()
              } catch (cause) {
                setError(String(cause))
              } finally {
                setBusy(false)
              }
            })()
          }}
          className="relative terminal-ai-glass-editor aui-edit-composer-root border-border/60 dark:border-muted-foreground/15 ms-auto flex w-full max-w-[85%] cursor-text flex-col rounded-(--composer-radius) border bg-(--composer-bg)"
        >
          {typeof children === "function" ? children(busy || running) : children}
          {renderInput ? renderInput(busy || running) : <ComposerPrimitive.Input
            className="aui-edit-composer-input text-foreground min-h-14 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-base outline-none"
            autoFocus
            disabled={busy || running}
          />}
          <div className="aui-edit-composer-footer mx-2.5 mb-2.5 flex items-center gap-1.5 self-end">
            <ComposerPrimitive.Cancel disabled={busy} asChild>
              <Button variant="ghost" size="sm" className="h-8 rounded-full px-3.5">
                {t("cancel")}
              </Button>
            </ComposerPrimitive.Cancel>
            <Button
              type="submit"
              disabled={busy || running}
              size="sm"
              className="h-8 rounded-full px-3.5"
            >
              {t("save")}
            </Button>
          </div>
          {error && (
            <p role="alert" className="px-4 pb-2 text-xs text-destructive">
              {error}
            </p>
          )}
        </ComposerPrimitive.Root>
      </ComposerPrimitive.Unstable_TriggerPopoverRoot>
    </MessagePrimitive.Root>
  )
}

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({ className, ...rest }) => {
  const { t } = useTranslation("aiAssistant")
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn(
        "aui-branch-picker-root text-muted-foreground -ms-2 me-2 inline-flex items-center text-xs",
        className
      )}
      {...rest}
    >
      <BranchPickerPrimitive.Previous asChild>
        <TooltipIconButton tooltip={t("previousBranch")}>
          <ChevronLeftIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Previous>
      <span className="aui-branch-picker-state font-medium">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <TooltipIconButton tooltip={t("nextBranch")}>
          <ChevronRightIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  )
}
