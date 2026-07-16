
import { useState } from "react"
import type { TFunction } from "i18next"

import { FileText, Server as ServerIcon, X } from "lucide-react"
import {
  TransformComponent,
  TransformWrapper,
  useControls,
} from "react-zoom-pan-pinch"

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { Server as ManagedServer } from "@/lib/api"
import { getServerDisplayName, getServerShortName } from "@/lib/server-utils"
import { attachmentDataURL, formatFileSize, type ComposerAttachment } from "./attachments"

type ComposerTranslate = TFunction<"aiAssistant">

function AttachmentImageContent({
  name,
  src,
  zoomed,
}: {
  name: string
  src: string
  zoomed: boolean
}) {
  const { centerView } = useControls()

  return (
    <TransformComponent
      wrapperClass={zoomed
        ? "cursor-grab active:cursor-grabbing"
        : "cursor-zoom-in"
      }
      wrapperStyle={{ width: "100%", height: "100%" }}
    >
      <img
        src={src}
        alt={name}
        className="block h-auto w-auto select-none object-contain"
        style={{
          maxWidth: "calc(98vw - 2rem)",
          maxHeight: "calc(96vh - 2rem)",
        }}
        draggable={false}
        onLoad={() => centerView(1, 0)}
      />
    </TransformComponent>
  )
}

function AttachmentImagePreview({ name, src }: { name: string; src: string }) {
  const [zoomed, setZoomed] = useState(false)

  return (
    <TransformWrapper
      initialScale={1}
      minScale={1}
      maxScale={2}
      smooth={false}
      centerOnInit
      centerZoomedOut={!zoomed}
      limitToBounds
      wheel={{ disabled: true }}
      panning={{
        disabled: !zoomed,
        velocityDisabled: true,
        allowLeftClickPan: true,
        allowMiddleClickPan: false,
        allowRightClickPan: false,
      }}
      autoAlignment={{
        sizeX: 12,
        sizeY: 12,
        animationTime: 220,
        velocityAlignmentTime: 220,
        animationType: "easeOut",
      }}
      doubleClick={{
        mode: "toggle",
        step: 1,
        animationTime: 200,
        animationType: "easeOut",
      }}
      onTransform={(_, state) => setZoomed(state.scale > 1.001)}
      onZoomStop={(ref) => {
        if (ref.state.scale <= 1.001) {
          setZoomed(false)
          ref.centerView(1, 200, "easeOut")
        }
      }}
    >
      <AttachmentImageContent name={name} src={src} zoomed={zoomed} />
    </TransformWrapper>
  )
}

export function ComposerReferenceChips({
  attachments,
  onClearServers,
  onRemoveAttachment,
  onToggleServer,
  selectedServers,
  t,
}: {
  attachments: ComposerAttachment[]
  onClearServers: () => void
  onRemoveAttachment: (attachmentId: string) => void
  onToggleServer: (serverId: string) => void
  selectedServers: ManagedServer[]
  t: ComposerTranslate
}) {
  const [previewAttachmentId, setPreviewAttachmentId] = useState<string | null>(null)
  const previewAttachment = attachments.find(
    (attachment) => attachment.id === previewAttachmentId && attachment.source === "image",
  )

  const closeImagePreview = () => {
    setPreviewAttachmentId(null)
  }

  if (selectedServers.length === 0 && attachments.length === 0) {
    return null
  }

  return (
    <>
      <div className="mb-2 flex flex-col gap-2 px-1">
        {selectedServers.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {t("referencedServersLabel")}
            </span>
            {selectedServers.map((server) => (
              <Tooltip key={server.id} delayDuration={150}>
                <TooltipTrigger asChild>
                  <span
                    className="inline-flex max-w-full cursor-default items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-xs text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5"
                  >
                    <ServerIcon className="size-3.5 text-muted-foreground" />
                    <span className="max-w-[10rem] truncate">{getServerShortName(server)}</span>
                    <button
                      type="button"
                      className="text-muted-foreground transition-colors hover:text-foreground"
                      onClick={() => onToggleServer(server.id)}
                    >
                      <X className="size-3.5" />
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[16rem]">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-semibold">{getServerDisplayName(server)}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {server.username}@{server.host}:{server.port}
                    </span>
                    {server.group && (
                      <span className="text-[11px] text-muted-foreground">{server.group}</span>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            ))}
            <button
              type="button"
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
              onClick={onClearServers}
            >
              {t("referenceServerClear")}
            </button>
          </div>
        )}

        {attachments.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {attachments.map((attachment) => (
              <span
                key={attachment.id}
                className="inline-flex max-w-full cursor-default items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-xs text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5"
              >
                {attachment.source === "image" ? (
                  <button
                    type="button"
                    className="shrink-0 cursor-zoom-in rounded outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    onClick={() => setPreviewAttachmentId(attachment.id)}
                    aria-label={`${t("attachedImage")}: ${attachment.name}`}
                  >
                    <img
                      src={attachmentDataURL(attachment)}
                      alt=""
                      className="size-5 rounded object-cover"
                    />
                  </button>
                ) : (
                  <FileText className="size-3.5 text-muted-foreground" />
                )}
                <span className="max-w-[12rem] truncate">{attachment.name}</span>
                <span className="text-muted-foreground">{formatFileSize(attachment.size)}</span>
                {attachment.truncated && (
                  <span className="text-muted-foreground">{t("attachmentInlineTruncated")}</span>
                )}
                <button
                  type="button"
                  className="text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => onRemoveAttachment(attachment.id)}
                >
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <Dialog
        open={Boolean(previewAttachment)}
        onOpenChange={(open) => {
          if (!open) {
            closeImagePreview()
          }
        }}
      >
        {previewAttachment && (
          <DialogContent
            showCloseButton={false}
            className="flex h-[96vh] w-[98vw] max-w-none items-center justify-center border-0 bg-transparent p-4 shadow-none sm:max-w-none"
            onEscapeKeyDown={closeImagePreview}
          >
            <DialogTitle className="sr-only">{previewAttachment.name}</DialogTitle>
            <DialogClose
              className="absolute right-2 top-2 z-10 inline-flex size-9 items-center justify-center rounded-full bg-background/85 text-foreground shadow-sm backdrop-blur transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t("closeImagePreview")}
            >
              <X className="size-5" />
            </DialogClose>
            <AttachmentImagePreview
              key={previewAttachment.id}
              name={previewAttachment.name}
              src={attachmentDataURL(previewAttachment) || ""}
            />
          </DialogContent>
        )}
      </Dialog>
    </>
  )
}
