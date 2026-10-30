import type { TFunction } from "i18next"
import { AttachmentTile, AttachmentRemoveButton } from "@/components/assistant-ui/elements/attachment.aui"
import { formatFileSize, type ComposerAttachment } from "./attachments"

export function ComposerAttachmentList({
  attachments,
  onRemoveAttachment,
  t
}: {
  attachments: ComposerAttachment[]
  onRemoveAttachment: (attachmentId: string) => void
  t: TFunction<"aiAssistant">
}) {
  if (attachments.length === 0) return null
  return (
    <div className="mb-2 flex flex-wrap items-start gap-3 px-1">
      {attachments.map((attachment) => (
        <div key={attachment.id} className="flex max-w-32 flex-col gap-1">
          <AttachmentTile
            name={attachment.name}
            src={attachment.previewUrl}
            isImage={attachment.source === "image"}
            removeControl={
              <AttachmentRemoveButton
                tooltip={t("auiRemoveFile")}
                onClick={() => onRemoveAttachment(attachment.id)}
              />
            }
          />
          <span className="truncate text-xs" title={attachment.name}>
            {attachment.name}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {formatFileSize(attachment.size)}
            {attachment.truncated && ` · ${t("attachmentInlineTruncated")}`}
          </span>
        </div>
      ))}
    </div>
  )
}
