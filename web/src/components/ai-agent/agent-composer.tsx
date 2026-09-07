import { ComposerPrimitive, useAui } from "@assistant-ui/react"
import { type ComponentProps } from "react"
import { Composer, ComposerInput } from "@/components/assistant-ui/elements/composer.aui"
export {
  ComposerToolbar as AgentComposerToolbar,
  ComposerActions as AgentComposerTools,
  ComposerSubmit as AgentComposerSubmit,
  ComposerDictation as AgentComposerDictation,
  ComposerAttachButton as AgentComposerAttachButton
} from "@/components/assistant-ui/elements/composer.aui"

import { cn } from "@/lib/utils"

// EasySSH adds server context and converts attachments before sending. Draft
// state, textarea sizing and keyboard handling belong to assistant-ui.
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
        const text = new FormData(event.currentTarget).get("message")
        void onSubmit(typeof text === "string" ? text : "")
      }}
    />
  )
}

export function AgentComposerInput({ className, ...props }: ComponentProps<typeof ComposerPrimitive.Input>) {
  return (
    <ComposerInput
      {...props}
      name="message"
      className={cn(
        "block w-full resize-none border-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      cancelOnEscape={false}
      addAttachmentOnPaste={false}
    />
  )
}
