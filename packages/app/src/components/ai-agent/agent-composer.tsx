import { ComposerPrimitive, useAui, useAuiState } from "@assistant-ui/react"
import { useEffect, type ComponentProps, type Ref } from "react"
import { Composer, ComposerSubmit } from "@/components/assistant-ui/elements/composer.aui"
import { LexicalComposerInput } from "@assistant-ui/react-lexical"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { COMMAND_PRIORITY_NORMAL, KEY_ENTER_COMMAND } from "lexical"
import { serverReferenceFormatter } from "@/lib/ai-agent/server-mentions"
export {
  ComposerToolbar as AgentComposerToolbar,
  ComposerActions as AgentComposerTools,
  ComposerDictation as AgentComposerDictation,
  ComposerAttachButton as AgentComposerAttachButton
} from "@/components/assistant-ui/elements/composer.aui"

import { cn } from "@/lib/utils"

// EasySSH adds server context and converts attachments before sending. Draft
// state and inline references belong to assistant-ui; all sends use this form.
export function AgentComposer({
  className,
  onSubmit,
  ...props
}: Omit<ComponentProps<typeof ComposerPrimitive.Root>, "onSubmit"> & {
  onSubmit: (text: string) => void | Promise<void>
}) {
  const aui = useAui()
  return (
    <Composer
      {...props}
      className={className}
      onSubmit={(event) => {
        event.preventDefault()
        if (aui.composer.getState().dictation != null) return
        const submit = event.currentTarget.querySelector<HTMLButtonElement>('button[type="submit"]')
        if (!submit || submit.disabled) return
        void onSubmit(aui.composer.getState().text)
      }}
    />
  )
}

export function AgentComposerInput({ ref, disabled = false, className, children, ...props }: ComponentProps<typeof LexicalComposerInput> & {
  disabled?: boolean
}) {
  return (
    <LexicalComposerInput
      {...props}
      aria-disabled={disabled}
      formatter={serverReferenceFormatter}
      submitMode="none"
      className={cn(
        "relative block min-h-10 max-h-52 w-full border-0 bg-transparent text-sm outline-none [&_.aui-lexical-input]:min-h-10 [&_.aui-lexical-input]:px-2.5 [&_.aui-lexical-input]:py-1 [&_.aui-lexical-input]:leading-6 [&_.aui-lexical-input]:outline-none [&_.aui-lexical-placeholder]:pointer-events-none [&_.aui-lexical-placeholder]:absolute [&_.aui-lexical-placeholder]:inset-x-2.5 [&_.aui-lexical-placeholder]:top-1 [&_.aui-lexical-placeholder]:select-none [&_.aui-lexical-placeholder]:leading-6 [&_.aui-lexical-placeholder]:text-muted-foreground/60 [&_.aui-directive-chip]:inline-block [&_.aui-directive-chip]:rounded [&_.aui-directive-chip]:bg-accent [&_.aui-directive-chip]:px-1 [&_.aui-directive-chip]:text-accent-foreground",
        disabled && "cursor-not-allowed opacity-50",
        className
      )}
      cancelOnEscape={false}
    >
      <ComposerInputPlugin disabled={disabled} inputRef={ref} />
      {children}
    </LexicalComposerInput>
  )
}

function ComposerInputPlugin({ disabled, inputRef }: { disabled: boolean; inputRef?: Ref<HTMLDivElement> }) {
  const [editor] = useLexicalComposerContext()
  const runtimeDisabled = useAuiState((s) => s.thread.isDisabled || !!s.composer.dictation?.inputDisabled)
  useEffect(() => {
    editor.setEditable(!disabled && !runtimeDisabled)
  }, [disabled, runtimeDisabled, editor])
  useEffect(() => editor.registerRootListener((element) => {
    if (typeof inputRef === "function") inputRef(element as HTMLDivElement | null)
    else if (inputRef) inputRef.current = element as HTMLDivElement | null
  }), [editor, inputRef])
  useEffect(() => editor.registerCommand(KEY_ENTER_COMMAND, (event) => {
    if (!event || event.isComposing || editor.isComposing() || event.shiftKey || event.ctrlKey || event.metaKey) return false
    if (!editor.isEditable()) return false
    // The built-in high-priority handler lets the @ picker consume Enter first.
    // Sending must use our form so references, attachments and guards are applied.
    event.preventDefault()
    editor.getRootElement()?.closest("form")?.requestSubmit()
    return true
  }, COMMAND_PRIORITY_NORMAL), [editor])
  return null
}

export function AgentComposerSubmit({
  hasContent = false,
  disabled = false,
  ...props
}: Omit<ComponentProps<typeof ComposerSubmit>, "disabled"> & {
  hasContent?: boolean
  disabled?: boolean
}) {
  const hasText = useAuiState((s) => Boolean(s.composer.text.trim()))
  return <ComposerSubmit {...props} disabled={disabled || (!hasText && !hasContent)} />
}
