import { useTranslation } from "react-i18next"
import { Database, RefreshCw } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { InstanceBackupPanel, webInstanceBackupAdapter, type InstanceBackupAdapter } from "./instance-backup-panel"
import { SyncPanel } from "./sync-panel"
import type { SyncAdapter } from "@/lib/sync/types"

export function BackupRestoreTab({
  adapter,
  desktopMode = false,
  syncAdapter,
}: {
  adapter?: InstanceBackupAdapter
  desktopMode?: boolean
  syncAdapter?: SyncAdapter
} = {}) {
  const { t } = useTranslation("settingsManagementBackup")

  if (!desktopMode) {
    return (
      <div className="min-w-0 p-4">
        <InstanceBackupPanel adapter={webInstanceBackupAdapter} />
      </div>
    )
  }
  if (!adapter || !syncAdapter) {
    throw new Error("Desktop data and sync requires desktop backup and sync adapters")
  }

  return (
    <div className="min-w-0 space-y-4 p-4">
      <p className="text-sm text-muted-foreground">{t("dataAndSyncDescription")}</p>
      <Tabs defaultValue="sync" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="sync">
            <RefreshCw className="mr-2 size-4" />
            {t("syncTab")}
          </TabsTrigger>
          <TabsTrigger value="native">
            <Database className="mr-2 size-4" />
            {t("nativeTab")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="sync">
          <SyncPanel adapter={syncAdapter} desktopMode />
        </TabsContent>
        <TabsContent value="native">
          <InstanceBackupPanel adapter={adapter} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
