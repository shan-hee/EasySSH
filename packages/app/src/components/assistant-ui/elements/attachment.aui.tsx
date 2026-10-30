"use client"

import { useTranslation } from "react-i18next"

import {
  type PropsWithChildren,
  type FC,
  type ReactNode,
  type ComponentProps,
  isValidElement
} from "react"
import { XIcon, FileText, Loader2Icon, AlertCircleIcon } from "lucide-react"
import { AttachmentPrimitive, MessagePrimitive, useAuiState } from "@assistant-ui/react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Dialog, DialogTitle, DialogContent, DialogTrigger } from "@/components/ui/dialog"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { TooltipIconButton } from "@/components/assistant-ui/elements/tooltip-icon-button"
import { ImagePreview } from "@/components/assistant-ui/elements/image"
import { useAttachmentSrc } from "@/hooks/use-attachment-src"
import { cn } from "@/lib/utils"

const AttachmentPreviewDialog: FC<PropsWithChildren<{ src?: string }>> = ({ children, src }) => {
  const { t } = useTranslation("aiAssistant")

  if (!src) return children

  return (
    <Dialog>
      <DialogTrigger className="aui-attachment-preview-trigger cursor-zoom-in" asChild>
        {isValidElement(children) ? children : <button type="button">{children}</button>}
      </DialogTrigger>
      <DialogContent dismissOnEscape className="aui-attachment-preview-dialog-content [&>button]:bg-foreground/60 [&>button]:hover:bg-foreground/80 [&>button_svg]:text-background p-2 sm:max-w-3xl [&>button]:rounded-full [&>button]:p-1 [&>button]:opacity-100 [&>button]:ring-0!">
        <DialogTitle className="aui-sr-only sr-only">{t("auiAttachmentPreview")}</DialogTitle>
        <div className="aui-attachment-preview bg-background relative mx-auto flex max-h-[80dvh] w-full items-center justify-center overflow-hidden rounded-sm">
          <ImagePreview
            src={src}
            alt={t("auiAttachmentPreview")}
            containerClassName="w-full"
            className="mx-auto max-h-[80dvh] w-auto max-w-full rounded-sm"
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

const AttachmentThumb: FC<{ src?: string }> = ({ src }) => {
  const { t } = useTranslation("aiAssistant")

  return (
    <Avatar className="aui-attachment-tile-avatar h-full w-full rounded-none">
      <AvatarImage
        src={src}
        alt={t("auiAttachmentPreview")}
        className="aui-attachment-tile-image rounded-none object-cover"
      />
      <AvatarFallback>
        <FileText className="aui-attachment-tile-fallback-icon text-muted-foreground/80 size-6 stroke-[1.5]" />
      </AvatarFallback>
    </Avatar>
  )
}

// The registry tile also accepts prepared attachments from a host-side parser.
// Image preview, upload feedback and remove controls are shared by both callers.
export type AttachmentTileProps = {
  name: string
  src?: string
  isImage?: boolean
  isComposer?: boolean
  isUploading?: boolean
  errorMessage?: string
  removeControl?: ReactNode
}
export function AttachmentTile({
  name,
  src,
  isImage,
  isComposer = true,
  isUploading = false,
  errorMessage,
  removeControl
}: AttachmentTileProps) {
  const { t } = useTranslation("aiAssistant")
  const isError = !!errorMessage
  const typeLabel = t(isImage ? "attachedImage" : "attachedFile")
  return (
    <TooltipProvider>
      <Tooltip>
        <div
          data-slot="attachment-root"
          className={cn(
            "aui-attachment-root relative isolate w-fit",
            isComposer && "animate-in fade-in-0 zoom-in-95 duration-200 motion-reduce:animate-none",
            isImage && !isComposer && "aui-attachment-root-message only:*:first:size-24"
          )}
        >
          <AttachmentPreviewDialog src={src}>
            <TooltipTrigger asChild>
              <div
                className={cn(
                  "aui-attachment-tile bg-muted hover:after:bg-foreground/10 focus-visible:ring-ring/50 relative size-14 cursor-pointer overflow-hidden rounded-[var(--radius-xl)] transition-transform outline-none after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:ring-1 after:ring-border after:transition-colors after:ring-inset focus-visible:ring-1 active:scale-[0.96] motion-reduce:transition-none",
                  isError && "after:ring-destructive/60 dark:after:ring-destructive/60"
                )}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    e.currentTarget.click()
                  } else if (e.key === " ") {
                    e.preventDefault()
                  }
                }}
                onKeyUp={(e) => {
                  if (e.key === " ") e.currentTarget.click()
                }}
                aria-label={`${typeLabel}: ${name}${isError ? `, ${t("auiUploadFailed")}` : isUploading ? `, ${t("auiUploading")}` : ""}`}
              >
                <AttachmentThumb src={src} />
                {isUploading && (
                  <div
                    aria-hidden="true"
                    className="aui-attachment-tile-uploading bg-background/60 animate-in fade-in-0 absolute inset-0 flex items-center justify-center backdrop-blur-[2px] motion-reduce:animate-none"
                  >
                    <Loader2Icon className="text-muted-foreground size-4 animate-spin" />
                  </div>
                )}
                {isError && (
                  <div
                    aria-hidden="true"
                    className="aui-attachment-tile-error bg-background/70 animate-in fade-in-0 absolute inset-0 flex items-center justify-center backdrop-blur-[2px] motion-reduce:animate-none"
                  >
                    <AlertCircleIcon className="text-destructive size-4" />
                  </div>
                )}
              </div>
            </TooltipTrigger>
          </AttachmentPreviewDialog>
          {removeControl}
        </div>
        <TooltipContent side="top">
          {name}
          {errorMessage && <p className="aui-attachment-error-message">{errorMessage}</p>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function AttachmentRemoveButton(props: ComponentProps<typeof TooltipIconButton>) {
  return (
    <TooltipIconButton
      {...props}
      className="aui-attachment-tile-remove absolute end-1 top-1 z-10 size-5 rounded-full border border-border bg-popover! text-popover-foreground shadow-sm after:absolute after:-inset-1.5 hover:bg-accent! hover:text-accent-foreground! active:scale-[0.96] motion-reduce:transition-none"
      side="top"
    >
      <XIcon className="aui-attachment-remove-icon size-3 stroke-[2.5]" />
    </TooltipIconButton>
  )
}

const AttachmentUI: FC = () => {
  const { t } = useTranslation("aiAssistant")
  const attachment = useAuiState((s) => s.attachment)
  const src = useAttachmentSrc()
  return (
    <AttachmentPrimitive.Root>
      <AttachmentTile
        name={attachment.name}
        src={src}
        isImage={attachment.type === "image"}
        isComposer={false}
        isUploading={attachment.status.type === "running"}
        errorMessage={
          attachment.status.type === "incomplete" && attachment.status.reason === "error"
            ? attachment.status.message || t("auiUploadFailed")
            : undefined
        }
      />
    </AttachmentPrimitive.Root>
  )
}

export const UserMessageAttachments: FC = () => {
  return (
    <div className="aui-user-message-attachments-end col-span-full col-start-1 row-start-1 flex w-full flex-row justify-end gap-2">
      <MessagePrimitive.Attachments>{() => <AttachmentUI />}</MessagePrimitive.Attachments>
    </div>
  )
}
