import { useCallback } from "react"
import { SftpManager, type SftpManagerProps } from "@/components/sftp/sftp-manager"
import { useOptionalSshWorkspace } from "@/components/ssh-workspace/ssh-workspace"
import { useWorkspaceSftpTranslator } from "@/components/ssh-workspace/use-workspace-translator"
import { quoteShellArgument } from "@/lib/shell-quote"

export interface TerminalSftpPanelProps extends SftpManagerProps {
  onInsertTerminalText?: (text: string) => void
  onExecuteTerminalCommand?: (command: string) => void
}

/** 终端场景只注入路径联动能力，不增加额外可见产品壳。 */
export function TerminalSftpPanel({
  currentPath,
  onInsertTerminalText,
  onExecuteTerminalCommand,
  onDisconnect,
  ...managerProps
}: TerminalSftpPanelProps) {
  const workspace = useOptionalSshWorkspace()
  const tSftp = useWorkspaceSftpTranslator()

  const handleCopyPath = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(currentPath)
      workspace?.adapters.notifier?.success(tSftp("terminalPathCopied"))
    } catch (error) {
      console.error("[TerminalSftpPanel] Failed to copy path:", error)
      workspace?.adapters.notifier?.error(tSftp("terminalPathCopyFailed"))
    }
  }, [currentPath, tSftp, workspace?.adapters.notifier])

  const handleInsertPath = useCallback(() => {
    onInsertTerminalText?.(quoteShellArgument(currentPath))
  }, [currentPath, onInsertTerminalText])

  const handleEnterPath = useCallback(() => {
    onExecuteTerminalCommand?.(`cd -- ${quoteShellArgument(currentPath)}`)
  }, [currentPath, onExecuteTerminalCommand])

  return (
    <SftpManager
      {...managerProps}
      currentPath={currentPath}
      onDisconnect={onDisconnect}
      viewModeStorageKey={managerProps.viewModeStorageKey ?? "easyssh:sftp:viewMode:terminal"}
      defaultViewMode={managerProps.defaultViewMode ?? "list"}
      surface={managerProps.surface ?? "transparent"}
      terminalPathActions={onInsertTerminalText && onExecuteTerminalCommand
        ? {
            onCopy: handleCopyPath,
            onInsert: handleInsertPath,
            onEnter: handleEnterPath,
          }
        : undefined}
    />
  )
}
