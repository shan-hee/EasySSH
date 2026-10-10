import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  RefreshCw,
  FileJson,
  ArchiveRestore,
  Database,
  Download,
  FileCog,
  Loader2,
  LockKeyhole,
  Upload,
} from "lucide-react"
import { toast } from "sonner"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { InstanceBackupPanel, webInstanceBackupAdapter, type InstanceBackupAdapter } from "./instance-backup-panel"
import { SyncPanel } from "./sync-panel"
import type { SyncAdapter } from "@/lib/sync/types"
import { Button } from "@/components/ui/button"
import { SettingsSection } from "@/components/settings/settings-section"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { useSystemConfig } from "@/contexts/system-config-context"
import { useConfirmDialog } from "@/hooks/use-confirm-dialog"
import { authenticatedFetch } from "@/lib/api-client"
import { getApiUrl } from "@/lib/config"
import type { components } from "@/types/openapi"

export type BackupContent = "config" | "database"
type BackupExportContract = components["schemas"]["BackupExportRequest"]
type ExportBackupOptions = BackupExportContract & {
  include_config: boolean
  include_database: boolean
}
type RestoreBackupOptions = components["schemas"]["BackupRestoreOptions"]
export type ConflictStrategy = RestoreBackupOptions["conflict_strategy"]
type ImportReport = components["schemas"]["BackupRestoreResponse"]
export interface BackupRestoreAdapter {
  instanceBackup: InstanceBackupAdapter
  exportBackup: (options: ExportBackupOptions) => Promise<{ blob: Blob; filename?: string }>
  restoreBackup: (file: File, options: RestoreBackupOptions) => Promise<ImportReport>
  previewBackup: (file: File, options: RestoreBackupOptions) => Promise<ImportReport>
  supportsConfig?: boolean
  supportsSensitive?: boolean
}
type BackupTranslationKey =
  | "contentConfigTitle"
  | "contentConfigDescription"
  | "contentDatabaseTitle"
  | "contentDatabaseDescription"
  | "desktopContentDatabaseDescription"
type ConflictTranslationKey =
  | "conflictSkipTitle"
  | "conflictSkipDescription"
  | "conflictOverwriteTitle"
  | "conflictOverwriteDescription"
  | "conflictErrorTitle"
  | "conflictErrorDescription"

type BackupTranslator = (key: BackupTranslationKey) => string

const contentOptions: Array<{
  value: BackupContent
  icon: typeof FileCog
  titleKey: BackupTranslationKey
  descriptionKey: BackupTranslationKey
}> = [
  {
    value: "config",
    icon: FileCog,
    titleKey: "contentConfigTitle",
    descriptionKey: "contentConfigDescription",
  },
  {
    value: "database",
    icon: Database,
    titleKey: "contentDatabaseTitle",
    descriptionKey: "contentDatabaseDescription",
  },
]

const conflictOptions: Array<{
  value: ConflictStrategy
  titleKey: ConflictTranslationKey
  descriptionKey: ConflictTranslationKey
}> = [
  {
    value: "skip",
    titleKey: "conflictSkipTitle",
    descriptionKey: "conflictSkipDescription",
  },
  {
    value: "overwrite",
    titleKey: "conflictOverwriteTitle",
    descriptionKey: "conflictOverwriteDescription",
  },
  {
    value: "error",
    titleKey: "conflictErrorTitle",
    descriptionKey: "conflictErrorDescription",
  },
]

export function BackupRestoreTab({
  adapter,
  desktopMode = false,
  syncAdapter,
}: {
  adapter?: BackupRestoreAdapter
  desktopMode?: boolean
  syncAdapter?: SyncAdapter
} = {}) {
  if (desktopMode && (!adapter || !syncAdapter)) {
    throw new Error("Desktop data and sync requires desktop backup and sync adapters")
  }

  const { t } = useTranslation("settingsManagementBackup")
  const { confirm: requestConfirm, confirmDialog } = useConfirmDialog()
  const { refreshConfig } = useSystemConfig()
  const restoreFileInputRef = useRef<HTMLInputElement>(null)
  const fileSelectionRef = useRef(0)
  const [restoreFile, setRestoreFile] = useState<File | null>(null)
  const [restoreFileInfo, setRestoreFileInfo] = useState<{
    encrypted: boolean
    source: "server" | "desktop"
    contents: Record<BackupContent, boolean>
    date?: string
  } | null>(null)
  const [loading, setLoading] = useState<"export" | "restore" | null>(null)
  const [exportContent, setExportContent] = useState<Record<BackupContent, boolean>>({
    config: true,
    database: true,
  })
  const [restoreContent, setRestoreContent] = useState<Record<BackupContent, boolean>>({
    config: true,
    database: true,
  })
  const [conflictStrategy, setConflictStrategy] = useState<ConflictStrategy>("skip")
  const [includeSensitive, setIncludeSensitive] = useState(false)
  const [exportEncryptionMode, setExportEncryptionMode] = useState<"passphrase" | "x25519">(
    "passphrase",
  )
  const [agePassphrase, setAgePassphrase] = useState("")
  const [ageRecipients, setAgeRecipients] = useState("")
  const [restoreEncryptionMode, setRestoreEncryptionMode] = useState<"passphrase" | "x25519">(
    "passphrase",
  )
  const [restoreAgePassphrase, setRestoreAgePassphrase] = useState("")
  const [ageIdentities, setAgeIdentities] = useState("")

  const activeAdapter = adapter || createWebBackupRestoreAdapter()
  const supportsConfig = activeAdapter.supportsConfig !== false
  const supportsSensitive = activeAdapter.supportsSensitive !== false
  const visibleContentOptions = supportsConfig
    ? contentOptions
    : contentOptions.filter((option) => option.value !== "config")
  const exportSelected = (supportsConfig && exportContent.config) || exportContent.database
  const restoreSelected = (supportsConfig && restoreContent.config) || restoreContent.database

  useEffect(() => {
    if (!supportsConfig) {
      setExportContent((current) => ({ ...current, config: false, database: true }))
      setRestoreContent((current) => ({ ...current, config: false, database: true }))
    }
  }, [supportsConfig])

  useEffect(() => {
    if (!includeSensitive) {
      setAgePassphrase("")
      setAgeRecipients("")
    }
  }, [includeSensitive])

  useEffect(() => {
    if (!supportsSensitive) {
      setIncludeSensitive(false)
      setAgePassphrase("")
      setAgeRecipients("")
      setRestoreAgePassphrase("")
      setAgeIdentities("")
    }
  }, [supportsSensitive])

  const toggleExportContent = (value: BackupContent, checked: boolean) => {
    setExportContent((current) => ({
      ...current,
      [value]: checked,
    }))
  }

  const toggleRestoreContent = (value: BackupContent, checked: boolean) => {
    setRestoreContent((current) => ({
      ...current,
      [value]: checked,
    }))
  }

  const handleExport = async () => {
    if (!exportSelected) {
      toast.error(t("toastSelectExportContent"))
      return
    }
    if (includeSensitive) {
      if (exportEncryptionMode === "passphrase" && agePassphrase.trim() === "") {
        toast.error(t("toastAgePassphraseRequired"))
        return
      }
      if (exportEncryptionMode === "x25519" && parseAgeKeys(ageRecipients).length === 0) {
        toast.error(t("toastAgeRecipientRequired"))
        return
      }
    }

    try {
      setLoading("export")
      toast.info(t("toastExportLoading"))

      const { blob, filename } = await activeAdapter.exportBackup({
        include_config: supportsConfig && exportContent.config,
        include_database: exportContent.database,
        include_sensitive: supportsSensitive && includeSensitive,
        age_passphrase:
          supportsSensitive && includeSensitive && exportEncryptionMode === "passphrase"
            ? agePassphrase
            : undefined,
        age_recipients:
          supportsSensitive && includeSensitive && exportEncryptionMode === "x25519"
            ? parseAgeKeys(ageRecipients)
            : undefined,
      })
      const downloadUrl = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = downloadUrl
      a.download = filename || `easyssh_application_data_${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(downloadUrl)
      document.body.removeChild(a)

      toast.success(t("toastExportSuccess"))
      if (includeSensitive) {
        setAgePassphrase("")
        setAgeRecipients("")
      }
    } catch (error) {
      console.error("Failed to export backup:", error)
      toast.error(error instanceof Error ? error.message : t("toastExportFailed"))
    } finally {
      setLoading(null)
    }
  }

  const handleRestoreClick = () => {
    if (!restoreSelected) {
      toast.error(t("toastSelectRestoreContent"))
      return
    }
    if (restoreFile) void handleRestoreFile(restoreFile)
  }

  const handleRestoreFile = async (file: File) => {
    try {
      setLoading("restore")
      const options: RestoreBackupOptions = {
        include_config: supportsConfig && restoreContent.config,
        include_database: restoreContent.database,
        conflict_strategy: conflictStrategy,
        age_passphrase:
          restoreEncryptionMode === "passphrase" && restoreAgePassphrase.trim() !== ""
            ? restoreAgePassphrase
            : undefined,
        age_identities:
          restoreEncryptionMode === "x25519" && parseAgeKeys(ageIdentities).length !== 0
            ? parseAgeKeys(ageIdentities)
            : undefined,
      }

      const preview = await activeAdapter.previewBackup(file, options)
      const totals = Object.values(preview.summary).reduce((sum, section) => ({
        inserted: sum.inserted + section.inserted,
        updated: sum.updated + section.updated,
        skipped: sum.skipped + section.skipped,
      }), { inserted: 0, updated: 0, skipped: 0 })
      const ignored = preview.ignored_fields || []
      const ownershipHint = !desktopMode && restoreFileInfo?.source === "desktop"
        ? ` ${t("desktopImportOwnershipHint")}`
        : ""
      const confirmed = await requestConfirm({
        description: `${t("importPreview", totals)}${ignored.length ? ` ${t("ignoredFields")}: ${ignored.join(", ")}.` : ""} ${t("importPreviewRecheck")}${ownershipHint}`,
      })
      if (!confirmed) return
      toast.info(t("toastRestoreLoading"))
      const result = await activeAdapter.restoreBackup(file, options)
      if (result.ignored_fields?.length) toast.info(`${t("ignoredFields")}: ${result.ignored_fields.join(", ")}`)

      if (supportsConfig && restoreContent.config && !desktopMode) {
        await refreshConfig({ refreshAuth: false })
      }

      toast.success(t("toastRestoreSuccess"))
      setRestoreFile(null)
      setRestoreFileInfo(null)
      window.dispatchEvent(new Event("easyssh:sync-applied"))
      setRestoreAgePassphrase("")
      setAgeIdentities("")
    } catch (error) {
      console.error("Failed to restore backup:", error)
      toast.error(error instanceof Error ? error.message : t("toastRestoreFailed"))
    } finally {
      setLoading(null)
      if (restoreFileInputRef.current) {
        restoreFileInputRef.current.value = ""
      }
    }
  }

  return (
    <div className="min-w-0 p-4">
      {confirmDialog}
      <Tabs defaultValue={desktopMode ? "sync" : "native"} className="space-y-4">
        <TabsList className={`grid w-full ${desktopMode ? "grid-cols-4" : "grid-cols-3"}`}>
          {desktopMode && (
            <TabsTrigger value="sync">
              <RefreshCw className="mr-2 size-4" />
              {t("syncTab")}
            </TabsTrigger>
          )}
          <TabsTrigger value="native"><Database className="mr-2 size-4" />{t("nativeTab")}</TabsTrigger>
          <TabsTrigger value="export">
            <Download className="mr-2 size-4" />
            {t("exportTab")}
          </TabsTrigger>
          <TabsTrigger value="restore">
            <ArchiveRestore className="mr-2 size-4" />
            {t("restoreTab")}
          </TabsTrigger>
        </TabsList>
        {desktopMode && syncAdapter && (
          <TabsContent value="sync">
            <SyncPanel adapter={syncAdapter} desktopMode />
          </TabsContent>
        )}
        <TabsContent value="native">
          <InstanceBackupPanel adapter={activeAdapter.instanceBackup} />
        </TabsContent>
        <TabsContent value="export">
          <SettingsSection
            title={t("exportTitle")}
            description={t("exportDescription")}
            icon={<Download className="h-5 w-5" />}
          >
            <ContentSelector
              idPrefix="export"
              options={visibleContentOptions}
              values={exportContent}
              onChange={toggleExportContent}
              disabled={loading !== null}
              desktopMode={desktopMode}
              t={t}
            />

            {supportsSensitive && (
              <div className="space-y-3 rounded-md border bg-background/40 p-3">
                <Label
                  htmlFor="export-include-sensitive"
                  className="flex cursor-pointer items-start gap-3"
                >
                  <Checkbox
                    id="export-include-sensitive"
                    checked={includeSensitive}
                    disabled={loading !== null}
                    onCheckedChange={(checked) => setIncludeSensitive(checked === true)}
                    className="mt-0.5"
                  />
                  <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 space-y-1">
                    <span className="block text-sm font-medium leading-none">
                      {t("sensitiveExportTitle")}
                    </span>
                    <span className="block text-xs font-normal leading-5 text-muted-foreground">
                      {desktopMode
                        ? t("desktopSensitiveExportDescription")
                        : t("sensitiveExportDescription")}
                    </span>
                  </span>
                </Label>
                {includeSensitive && (
                  <div className="space-y-3">
                    <RadioGroup
                      value={exportEncryptionMode}
                      onValueChange={(value) =>
                        setExportEncryptionMode(value as "passphrase" | "x25519")
                      }
                      className="grid grid-cols-2 gap-2"
                      disabled={loading !== null}
                    >
                      <Label
                        htmlFor="export-age-passphrase-mode"
                        className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-xs"
                      >
                        <RadioGroupItem id="export-age-passphrase-mode" value="passphrase" />
                        {t("agePassphraseMode")}
                      </Label>
                      <Label
                        htmlFor="export-age-x25519-mode"
                        className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-xs"
                      >
                        <RadioGroupItem id="export-age-x25519-mode" value="x25519" />
                        {t("ageX25519Mode")}
                      </Label>
                    </RadioGroup>
                    {exportEncryptionMode === "passphrase" ? (
                      <div className="space-y-1">
                        <Label htmlFor="age-passphrase" className="text-xs font-medium">
                          {t("agePassphraseLabel")}
                        </Label>
                        <Input
                          id="age-passphrase"
                          type="password"
                          value={agePassphrase}
                          onChange={(event) => setAgePassphrase(event.target.value)}
                          disabled={loading !== null}
                          autoComplete="new-password"
                          placeholder={t("agePassphrasePlaceholder")}
                        />
                        <p className="text-xs leading-5 text-muted-foreground">
                          {t("agePassphraseHint")}
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <Label htmlFor="age-recipients" className="text-xs font-medium">
                          {t("ageRecipientsLabel")}
                        </Label>
                        <Textarea
                          id="age-recipients"
                          value={ageRecipients}
                          onChange={(event) => setAgeRecipients(event.target.value)}
                          disabled={loading !== null}
                          autoComplete="off"
                          placeholder={t("ageRecipientsPlaceholder")}
                          className="min-h-20 font-mono text-xs"
                        />
                        <p className="text-xs leading-5 text-muted-foreground">
                          {t("ageRecipientsHint")}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-3 border-t pt-4">
              <div className="space-y-1 text-xs leading-5 text-muted-foreground">
                <p>{t("exportHintFormat")}</p>
                <p>{desktopMode ? t("desktopExportHintContent") : t("exportHintContent")}</p>
              </div>
              <div className="flex justify-end">
                <Button
                  className="w-full sm:w-auto sm:min-w-36"
                  onClick={handleExport}
                  disabled={loading !== null || !exportSelected}
                >
                  {loading === "export" ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t("btnExportLoading")}
                    </>
                  ) : (
                    <>
                      <Download className="mr-2 h-4 w-4" />
                      {t("btnExport")}
                    </>
                  )}
                </Button>
              </div>
            </div>
          </SettingsSection>
        </TabsContent>
        <TabsContent value="restore">
          <SettingsSection
            title={t("restoreTitle")}
            description={t("restoreDescription")}
            icon={<ArchiveRestore className="h-5 w-5" />}
          >
            <button
              type="button"
              disabled={loading !== null}
              onClick={() => restoreFileInputRef.current?.click()}
              className="flex w-full items-center gap-4 rounded-lg border border-dashed bg-muted/20 p-5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              <FileJson className="size-8 shrink-0 text-muted-foreground" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">
                  {restoreFile?.name || t("selectFile")}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {restoreFile
                    ? `${(restoreFile.size / 1024).toFixed(1)} KB · ${restoreFileInfo?.encrypted ? t("encryptedFile") : t("plainFile")}`
                    : t("selectFileHint")}
                </span>
              </span>
            </button>
            <ContentSelector
              idPrefix="restore"
              options={visibleContentOptions.filter((option) =>
                !restoreFileInfo || restoreFileInfo.contents[option.value],
              )}
              values={restoreContent}
              onChange={toggleRestoreContent}
              disabled={loading !== null}
              desktopMode={desktopMode}
              t={t}
            />

            <div className="space-y-3 border-t pt-4">
              <div>
                <Label className="text-sm font-medium">{t("conflictStrategyLabel")}</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  {desktopMode
                    ? t("desktopConflictStrategyDescription")
                    : t("conflictStrategyDescription")}
                </p>
              </div>
              <RadioGroup
                value={conflictStrategy}
                onValueChange={(value) => setConflictStrategy(value as ConflictStrategy)}
                className="grid gap-2"
                disabled={loading !== null}
              >
                {conflictOptions.map((option) => (
                  <Label
                    key={option.value}
                    htmlFor={`conflict-${option.value}`}
                    className="flex min-h-[58px] cursor-pointer items-start gap-3 rounded-md border bg-background/40 p-3 transition-colors hover:bg-muted/50"
                  >
                    <RadioGroupItem
                      id={`conflict-${option.value}`}
                      value={option.value}
                      className="mt-0.5"
                    />
                    <span className="min-w-0 space-y-1">
                      <span className="block text-sm font-medium leading-none">
                        {t(option.titleKey)}
                      </span>
                      <span className="block text-xs font-normal leading-5 text-muted-foreground">
                        {t(option.descriptionKey)}
                      </span>
                    </span>
                  </Label>
                ))}
              </RadioGroup>
            </div>

            {supportsSensitive && restoreFileInfo?.encrypted && (
              <div className="space-y-3 border-t pt-4">
                <div>
                  <Label className="text-sm font-medium">{t("restoreAgeCredentialLabel")}</Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("restoreAgeCredentialHint")}
                  </p>
                </div>
                <RadioGroup
                  value={restoreEncryptionMode}
                  onValueChange={(value) =>
                    setRestoreEncryptionMode(value as "passphrase" | "x25519")
                  }
                  className="grid grid-cols-2 gap-2"
                  disabled={loading !== null}
                >
                  <Label
                    htmlFor="restore-age-passphrase-mode"
                    className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-xs"
                  >
                    <RadioGroupItem id="restore-age-passphrase-mode" value="passphrase" />
                    {t("agePassphraseMode")}
                  </Label>
                  <Label
                    htmlFor="restore-age-x25519-mode"
                    className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-xs"
                  >
                    <RadioGroupItem id="restore-age-x25519-mode" value="x25519" />
                    {t("ageX25519Mode")}
                  </Label>
                </RadioGroup>
                {restoreEncryptionMode === "passphrase" ? (
                  <Input
                    id="restore-age-passphrase"
                    type="password"
                    value={restoreAgePassphrase}
                    onChange={(event) => setRestoreAgePassphrase(event.target.value)}
                    disabled={loading !== null}
                    autoComplete="current-password"
                    placeholder={t("restoreAgePassphrasePlaceholder")}
                  />
                ) : (
                  <Textarea
                    id="restore-age-identities"
                    value={ageIdentities}
                    onChange={(event) => setAgeIdentities(event.target.value)}
                    disabled={loading !== null}
                    autoComplete="off"
                    placeholder={t("ageIdentitiesPlaceholder")}
                    className="min-h-20 font-mono text-xs"
                  />
                )}
              </div>
            )}

            <input
              ref={restoreFileInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) {
                  const selection = ++fileSelectionRef.current
                  setRestoreFile(null)
                  setRestoreFileInfo(null)
                  setRestoreAgePassphrase("")
                  setAgeIdentities("")
                  if (file.size > 32 * 1024 * 1024) {
                    toast.error(t("invalidBackupFile"))
                    return
                  }
                  void file
                    .text()
                    .then((text) => {
                      const content = JSON.parse(text)
                      if (
                        content.format !== "easyssh-application-data" ||
                        content.version !== "1.1" ||
                        (content.source !== "server" && content.source !== "desktop")
                      ) {
                        throw new Error(t("invalidBackupFile"))
                      }
                      if (selection !== fileSelectionRef.current) return
                      const contents = {
                        config: supportsConfig && !!content.config,
                        database: !!content.database,
                      }
                      setRestoreFile(file)
                      setRestoreContent(contents)
                      setRestoreFileInfo({
                        encrypted: !!content.sensitive,
                        source: content.source,
                        contents,
                        date: content.export_time,
                      })
                    })
                    .catch(() => {
                      if (selection === fileSelectionRef.current)
                        toast.error(t("invalidBackupFile"))
                    })
                }
              }}
            />

            <div className="space-y-3 border-t pt-4">
              <div className="space-y-1 text-xs leading-5 text-muted-foreground">
                <p>{t("restoreHintFormat")}</p>
                {!desktopMode && restoreFileInfo?.source === "desktop" && (
                  <p>{t("desktopImportOwnershipHint")}</p>
                )}
                <p className="text-destructive">{t("restoreHintWarning")}</p>
              </div>
              <div className="flex justify-end">
                <Button
                  variant={conflictStrategy === "overwrite" ? "destructive" : "outline"}
                  className="w-full sm:w-auto sm:min-w-44"
                  onClick={handleRestoreClick}
                  disabled={loading !== null || !restoreSelected || !restoreFile}
                >
                  {loading === "restore" ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t("btnRestoreLoading")}
                    </>
                  ) : (
                    <>
                      <Upload className="mr-2 h-4 w-4" />
                      {t("btnRestore")}
                    </>
                  )}
                </Button>
              </div>
            </div>
          </SettingsSection>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function createWebBackupRestoreAdapter(): BackupRestoreAdapter {
  return {
    instanceBackup: webInstanceBackupAdapter,
    async exportBackup(options) {
      const headers = {
        "Content-Type": "application/json",
      }
      const response = await authenticatedFetch(`${getApiUrl()}/backup/export`, {
        method: "POST",
        headers,
        body: JSON.stringify(options),
      })

      if (!response.ok) {
        const detail = await readErrorMessage(response)
        throw new Error(detail || "Export failed")
      }

      return {
        blob: await response.blob(),
        filename: getDownloadFilename(response),
      }
    },

    previewBackup: (file, options) => requestApplicationImport("preview", file, options),
    restoreBackup: (file, options) => requestApplicationImport("restore", file, options),
  }
}

async function requestApplicationImport(action: "preview" | "restore", file: File, options: RestoreBackupOptions): Promise<ImportReport> {
  const formData = new FormData()
  formData.append("file", file)
  formData.append("include_config", String(options.include_config))
  formData.append("include_database", String(options.include_database))
  formData.append("conflict_strategy", options.conflict_strategy)
  if (options.age_passphrase) formData.append("age_passphrase", options.age_passphrase)
  for (const identity of options.age_identities || []) formData.append("age_identities", identity)
  const response = await authenticatedFetch(`${getApiUrl()}/backup/${action}`, { method: "POST", body: formData })
  if (!response.ok) throw new Error(await readErrorMessage(response) || "Import failed")
  return response.json()

}

function parseAgeKeys(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function ContentSelector({
  idPrefix,
  options,
  values,
  onChange,
  disabled,
  desktopMode,
  t,
}: {
  idPrefix: string
  options: typeof contentOptions
  values: Record<BackupContent, boolean>
  onChange: (value: BackupContent, checked: boolean) => void
  disabled: boolean
  desktopMode?: boolean
  t: BackupTranslator
}) {
  if (options.length === 1)
    return (
      <p className="text-sm leading-6 text-muted-foreground">
        {t(desktopMode ? "desktopContentDatabaseDescription" : options[0].descriptionKey)}
      </p>
    )
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {options.map((option) => {
        const Icon = option.icon
        const inputId = `${idPrefix}-backup-content-${option.value}`
        return (
          <Label
            key={option.value}
            htmlFor={inputId}
            className="flex min-h-[74px] cursor-pointer items-start gap-3 rounded-md border bg-background/40 p-3 transition-colors hover:bg-muted/50"
          >
            <Checkbox
              id={inputId}
              checked={values[option.value]}
              disabled={disabled}
              onCheckedChange={(checked) => onChange(option.value, checked === true)}
              className="mt-0.5"
            />
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 space-y-1">
              <span className="block text-sm font-medium leading-none">{t(option.titleKey)}</span>
              <span className="block text-xs font-normal leading-5 text-muted-foreground">
                {t(
                  desktopMode && option.value === "database"
                    ? "desktopContentDatabaseDescription"
                    : option.descriptionKey,
                )}
              </span>
            </span>
          </Label>
        )
      })}
    </div>
  )
}

async function readErrorMessage(response: Response) {
  try {
    const data = await response.json()
    if (typeof data?.detail === "string") return data.detail
    if (typeof data?.error === "string") return data.error
  } catch {
    return ""
  }
  return ""
}

function getDownloadFilename(response: Response) {
  const disposition = response.headers.get("content-disposition")
  if (!disposition) return ""

  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1])
  }

  const match = disposition.match(/filename="?([^";]+)"?/i)
  return match?.[1] || ""
}
