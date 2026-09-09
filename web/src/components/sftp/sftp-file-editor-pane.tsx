
import { FileEditor } from "@/components/sftp/file-editor"

export interface SftpFileEditorPaneProps {
  fileName: string
  filePath: string
  fileContent: string
  isOpen: boolean
  keyboardShortcutsEnabled: boolean
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
      onSave={onSave}
      onDownload={onDownload}
    />
  )
}
