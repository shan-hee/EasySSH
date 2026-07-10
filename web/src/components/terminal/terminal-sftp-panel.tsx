import { useCallback, useMemo, useState } from "react"
import { Clipboard, CornerDownRight, FolderInput, SquareTerminal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SftpManager, type SftpManagerProps } from "@/components/sftp/sftp-manager"
import { useOptionalSshWorkspace } from "@/components/ssh-workspace/ssh-workspace"
import { useWorkspaceSftpTranslator } from "@/components/ssh-workspace/use-workspace-translator"
import { joinSftpRemotePath } from "@/lib/sftp-file-utils"
import { quoteShellArgument } from "@/lib/shell-quote"

export interface TerminalSftpPanelProps extends SftpManagerProps {
  onInsertTerminalText?: (text: string) => void
  onExecuteTerminalCommand?: (command: string) => void
}

export function TerminalSftpPanel({
  currentPath,
  files,
  onInsertTerminalText,
  onExecuteTerminalCommand,
  onSelectionChange,
  onDisconnect,
  ...managerProps
}: TerminalSftpPanelProps) {
  const workspace = useOptionalSshWorkspace()
  const tSftp = useWorkspaceSftpTranslator()
  const [selectedFileNames, setSelectedFileNames] = useState<string[]>([])

  const selectedFile = useMemo(() => (
    selectedFileNames.length === 1
      ? files.find((file) => file.name === selectedFileNames[0]) ?? null
      : null
  ), [files, selectedFileNames])
  const targetPath = selectedFile
    ? joinSftpRemotePath(currentPath, selectedFile.name)
    : currentPath
  const targetDirectory = selectedFile?.type === "directory" ? targetPath : currentPath

  const handleSelectionChange = useCallback((fileNames: string[]) => {
    setSelectedFileNames(fileNames)
    onSelectionChange?.(fileNames)
  }, [onSelectionChange])

  const handleCopyPath = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(targetPath)
      workspace?.adapters.notifier?.success(tSftp("terminalPathCopied"))
    } catch (error) {
      console.error("[TerminalSftpPanel] Failed to copy path:", error)
      workspace?.adapters.notifier?.error(tSftp("terminalPathCopyFailed"))
    }
  }, [tSftp, targetPath, workspace?.adapters.notifier])

  const handleInsertPath = useCallback(() => {
    onInsertTerminalText?.(quoteShellArgument(targetPath))
  }, [onInsertTerminalText, targetPath])

  const handleOpenInTerminal = useCallback(() => {
    const command = selectedFile?.type === "file"
      ? `less -- ${quoteShellArgument(targetPath)}`
      : `cd -- ${quoteShellArgument(targetDirectory)}`
    onExecuteTerminalCommand?.(command)
    onDisconnect()
  }, [onDisconnect, onExecuteTerminalCommand, selectedFile?.type, targetDirectory, targetPath])

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
      data-sftp-product-shell="terminal"
    >
      <div className="flex min-h-9 shrink-0 items-center gap-1 border-b bg-muted/30 px-2 py-1">
        <div className="flex min-w-0 flex-1 items-center gap-2 px-1">
          <SquareTerminal className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="truncate font-mono text-[11px] text-muted-foreground" title={targetPath}>
            {targetPath}
          </span>
          {selectedFileNames.length > 1 && (
            <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
              {tSftp("terminalSelectedCount", { count: selectedFileNames.length })}
            </span>
          )}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          onClick={() => void handleCopyPath()}
          disabled={selectedFileNames.length > 1}
          title={tSftp("terminalCopyPath")}
        >
          <Clipboard className="h-3.5 w-3.5" />
          <span className="hidden xl:inline">{tSftp("terminalCopyPathShort")}</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          onClick={handleInsertPath}
          disabled={!onInsertTerminalText || selectedFileNames.length > 1}
          title={tSftp("terminalInsertPath")}
        >
          <CornerDownRight className="h-3.5 w-3.5" />
          <span className="hidden xl:inline">{tSftp("terminalInsertPathShort")}</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          onClick={handleOpenInTerminal}
          disabled={!onExecuteTerminalCommand || selectedFileNames.length > 1}
          title={selectedFile?.type === "file"
            ? tSftp("terminalViewFile")
            : tSftp("terminalChangeDirectory")}
        >
          <FolderInput className="h-3.5 w-3.5" />
          <span className="hidden xl:inline">
            {selectedFile?.type === "file"
              ? tSftp("terminalViewFileShort")
              : tSftp("terminalChangeDirectoryShort")}
          </span>
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <SftpManager
          {...managerProps}
          currentPath={currentPath}
          files={files}
          viewModeStorageKey={managerProps.viewModeStorageKey ?? "easyssh:sftp:viewMode:terminal"}
          defaultViewMode={managerProps.defaultViewMode ?? "list"}
          surface={managerProps.surface ?? "transparent"}
          onDisconnect={onDisconnect}
          onSelectionChange={handleSelectionChange}
        />
      </div>
    </div>
  )
}
