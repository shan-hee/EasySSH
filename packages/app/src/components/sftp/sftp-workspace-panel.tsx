import { SftpManager, type SftpManagerProps } from "@/components/sftp/sftp-manager"

/**
 * SFTP 专用工作台中的单个会话面板。
 * 这里负责专业文件工作台的默认展示策略，文件浏览和操作仍由共享 SftpManager 承担。
 */
export function SftpWorkspacePanel(props: SftpManagerProps) {
  return (
    <div
      className="h-full min-h-0 min-w-0 overflow-hidden"
      data-sftp-product-shell="workspace-panel"
    >
      <SftpManager
        {...props}
        viewModeStorageKey={props.viewModeStorageKey ?? "easyssh:sftp:viewMode:sftp-workspace"}
        defaultViewMode={props.defaultViewMode ?? "list"}
      />
    </div>
  )
}
