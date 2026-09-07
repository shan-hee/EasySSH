import { type ComponentProps } from "react"
import { AuiIf, ComposerPrimitive, useAuiState } from "@assistant-ui/react"
import { ComposerBar, ComposerSend, ComposerVoiceButton } from "./composer"
import { cn } from "@/lib/utils"

// Official Composer primitives drive the input and voice controls; the surface
// and rail are the official Elements components.
export function Composer({ className, children, ...props }: ComponentProps<typeof ComposerPrimitive.Root>) {
  return (
    <ComposerPrimitive.Unstable_TriggerPopoverRoot>
      <ComposerPrimitive.Root {...props} className="aui-composer-root relative w-full">
        <ComposerBar className={className}>{children}</ComposerBar>
      </ComposerPrimitive.Root>
    </ComposerPrimitive.Unstable_TriggerPopoverRoot>
  )
}
export function ComposerInput({ className, ...props }: ComponentProps<typeof ComposerPrimitive.Input>) {
  return (
    <ComposerPrimitive.Input
      enterKeyHint="send"
      minRows={1}
      maxRows={8}
      {...props}
      className={cn(
        "aui-composer-input caret-primary placeholder:text-muted-foreground/60 min-h-10 w-full resize-none bg-transparent px-2.5 py-1 text-sm leading-6 outline-none disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
    />
  )
}
export function ComposerSubmit({
  running,
  disabled,
  onCancel
}: {
  running: boolean
  disabled: boolean
  onCancel: () => void | Promise<void>
}) {
  const dictating = useAuiState((s) => s.composer.dictation != null)
  return (
    <ComposerSend
      type={running ? "button" : "submit"}
      streaming={running}
      idle={disabled || dictating}
      disabled={!running && (disabled || dictating)}
      onClick={running ? () => void onCancel() : undefined}
    />
  )
}
export function ComposerDictation({ disabled }: { disabled?: boolean }) {
  const dictating = useAuiState((s) => s.composer.dictation != null)
  return (
    <AuiIf condition={(s) => s.thread.capabilities.dictation}>
      {dictating ? (
        <ComposerPrimitive.StopDictation asChild>
          <ComposerVoiceButton active />
        </ComposerPrimitive.StopDictation>
      ) : (
        <ComposerPrimitive.Dictate disabled={disabled} asChild>
          <ComposerVoiceButton active={false} />
        </ComposerPrimitive.Dictate>
      )}
    </AuiIf>
  )
}
export { ComposerToolbar, ComposerActions, ComposerAttachButton } from "./composer"
