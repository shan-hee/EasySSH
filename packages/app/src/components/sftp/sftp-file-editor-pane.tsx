
import { FileEditor } from "@/components/sftp/file-editor"

export interface SftpFileEditorPaneProps {
  fileName: string
  filePath: string
  fileContent: string
  isOpen: boolean
  keyboardShortcutsEnabled: boolean
  onDraftChange: (content: string) => void
  isBusy?: boolean
  onReady: () => void
  onClose: () => void
  onSave: (content: string) => Promise<void> | void
  onDownload: () => void
}

export function SftpFileEditorPane({
  fileName,
  filePath,
  fileContent,
  isOpen,
  keyboardShortcutsEnabled,
  onClose,
  onReady,
  onDraftChange,
  isBusy,
  onSave,
  onDownload,
}: SftpFileEditorPaneProps) {
  return (
    <FileEditor
      fileName={fileName}
      filePath={filePath}
      fileContent={fileContent}
      isOpen={isOpen}
      keyboardShortcutsEnabled={keyboardShortcutsEnabled}
      onClose={onClose}
      onReady={onReady}
      onDraftChange={onDraftChange}
      isBusy={isBusy}
      onSave={onSave}
      onDownload={onDownload}
    />
  )
}
