

import { PrivateKeyInput } from "@/components/servers/private-key-input"

import * as React from "react"

import { Key, Loader2, X, Copy, Eye } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"

import { useClientAuth } from "@/components/client-auth-provider"
import { useSystemConfig } from "@/contexts/system-config-context"

import * as sshKeysApi from "@/lib/api/ssh-keys"
import { getEffectiveLocale, getEffectiveTimezone, formatInTimezone } from "@/utils/datetime"
import { useConfirmDialog } from "@/hooks/use-confirm-dialog"

import { toast } from "sonner"
import { useTranslation } from "react-i18next"

import { getErrorMessage } from "@/lib/error-utils"

type SSHKeyManagerApi = sshKeysApi.SSHKeyApi & {
  generate?: typeof sshKeysApi.generateSSHKey
}

const webSSHKeyManagerApi: SSHKeyManagerApi = {
  ...sshKeysApi.sshKeyApi,
  generate: sshKeysApi.generateSSHKey,
}

export function AccountSSHKeys({ api = webSSHKeyManagerApi }: { api?: SSHKeyManagerApi }) {
const { t: tAccount } = useTranslation("accountSettings")
const { t: tServers } = useTranslation("servers")
const { confirm: requestConfirm, confirmDialog } = useConfirmDialog()
const { user } = useClientAuth()
const { config } = useSystemConfig()
const effectiveLocale = getEffectiveLocale(user, config), effectiveTimezone = getEffectiveTimezone(user, config)
  // SSH密钥管理状态
  const [sshKeys, setSshKeys] = React.useState<sshKeysApi.SSHKey[]>([])
  const [sshKeysLoading, setSshKeysLoading] = React.useState(false)
  const [generateDialogOpen, setGenerateDialogOpen] = React.useState(false)
  const [importDialogOpen, setImportDialogOpen] = React.useState(false)
  const [viewKeyDialogOpen, setViewKeyDialogOpen] = React.useState(false)
  const [selectedKey, setSelectedKey] = React.useState<sshKeysApi.SSHKey | sshKeysApi.SSHKeyWithPrivateKey | null>(null)
  const [generateForm, setGenerateForm] = React.useState({
    name: "",
    algorithm: "ed25519" as "rsa" | "ed25519",
    key_size: 2048,
  })
  const [importForm, setImportForm] = React.useState({
    name: "",
    private_key: "",
    passphrase: "",
  })
  const [generateLoading, setGenerateLoading] = React.useState(false)
  const [importLoading, setImportLoading] = React.useState(false)

  // 加载SSH密钥列表
  const loadSSHKeys = React.useCallback(async (background = false) => {
    if (!background) setSshKeysLoading(true)
    try {
      const keys = await api.list()
      setSshKeys(keys)
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, tAccount("sshKeysLoadFailed")))
    } finally {
      if (!background) setSshKeysLoading(false)
    }
  }, [api, tAccount])

  // 生成SSH密钥
  const handleGenerateKey = React.useCallback(async () => {
    if (!api.generate) return
    if (!generateForm.name.trim()) {
      toast.error(tAccount("sshKeyToastNameRequired"))
      return
    }

    setGenerateLoading(true)
    try {
      const newKey = await api.generate(generateForm)
      toast.success(tAccount("sshKeyToastGenerateSuccess"))
      setSelectedKey(newKey)
      setViewKeyDialogOpen(true)
      setGenerateDialogOpen(false)
      setGenerateForm({ name: "", algorithm: "ed25519", key_size: 2048 })
      loadSSHKeys() // 刷新列表
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, tAccount("sshKeyToastGenerateFailed")))
    } finally {
      setGenerateLoading(false)
    }
  }, [api, generateForm, loadSSHKeys, tAccount])

  // 导入SSH密钥
  const handleImportKey = React.useCallback(async () => {
    if (!importForm.name.trim()) {
      toast.error(tAccount("sshKeyToastNameRequired"))
      return
    }
    if (!importForm.private_key.trim()) {
      toast.error(tAccount("sshKeyToastPrivateKeyRequired"))
      return
    }

    setImportLoading(true)
    try {
      await api.import(importForm)
      toast.success(tAccount("sshKeyToastImportSuccess"))
      setImportDialogOpen(false)
      setImportForm({ name: "", private_key: "", passphrase: "" })
      loadSSHKeys() // 刷新列表
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, tAccount("sshKeyToastImportFailed")))
    } finally {
      setImportLoading(false)
    }
  }, [api, importForm, loadSSHKeys, tAccount])

  // 删除SSH密钥
  const handleDeleteKey = React.useCallback(async (keyId: number, keyName: string) => {
    const confirmed = await requestConfirm({
      description: tAccount("sshKeyConfirmDelete", { name: keyName }),
      variant: "destructive",
    })
    if (!confirmed) {
      return
    }

    try {
      await api.delete(keyId)
      toast.success(tAccount("sshKeyToastDeleteSuccess"))
      loadSSHKeys() // 刷新列表
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, tAccount("sshKeyToastDeleteFailed")))
    }
  }, [api, loadSSHKeys, requestConfirm, tAccount])

  // 复制到剪贴板
  const handleCopyToClipboard = React.useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(tAccount("copyToastSuccess", { label }))
    } catch {
      toast.error(tAccount("copyToastFailed"))
    }
  }, [tAccount])

React.useEffect(() => { void loadSSHKeys() }, [loadSSHKeys])
React.useEffect(() => {
  const refresh = (event: Event) => {
    if (event instanceof CustomEvent && event.detail?.serversChanged === false) return
    void loadSSHKeys(true)
  }
  window.addEventListener("easyssh:sync-applied", refresh)
  return () => window.removeEventListener("easyssh:sync-applied", refresh)
}, [loadSSHKeys])
return (<>{confirmDialog}<div className="space-y-4">
                    <div className="rounded-lg border p-4">
                      <div className="flex flex-wrap justify-between items-center gap-3 mb-3">
                        <div className="min-w-0">
                          <h4 className="font-medium">
                            {tAccount("sshSectionTitle")}
                          </h4>
                          <p className="text-sm text-muted-foreground">
                            {tAccount("sshSectionDescription")}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          {api.generate && <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setGenerateDialogOpen(true)}
                          >
                            {tAccount("sshGenerateButton")}
                          </Button>}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setImportDialogOpen(true)}
                          >
                            {tAccount("sshImportButton")}
                          </Button>
                        </div>
                      </div>

                      {sshKeysLoading ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                      ) : sshKeys.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                          <Key className="h-12 w-12 mx-auto mb-2 opacity-20" />
                          <p className="text-sm">
                            {tAccount("sshEmptyTitle")}
                          </p>
                          <p className="text-xs">
                            {tAccount(api.generate ? "sshEmptyDescription" : "sshEmptyImportDescription")}
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {sshKeys.map((key) => (
                            <div key={key.id} className="p-3 bg-background rounded border">
                              <div className="flex flex-wrap justify-between items-start gap-2">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <p className="text-sm font-medium">{key.name}</p>
                                    <span className="text-xs px-2 py-0.5 rounded bg-muted">
                                      {key.algorithm.toUpperCase()}
                                      {key.key_size ? ` ${key.key_size}` : ""}
                                    </span>
                                  </div>
                                  <p className="text-xs text-muted-foreground font-mono truncate">
                                    {key.fingerprint}
                                  </p>
                                  <p className="text-xs text-muted-foreground mt-1">
                                    {tAccount("sshCreatedAt", {
                                      date: formatInTimezone(
                                        key.created_at,
                                        { year: "numeric", month: "2-digit", day: "2-digit" },
                                        effectiveLocale,
                                        effectiveTimezone,
                                      ),
                                    })}
                                  </p>
                                </div>
                                <div className="flex shrink-0 gap-1">
                                  <Button variant="ghost" size="sm" aria-label={tAccount("sshViewDialogTitle")} title={tAccount("sshViewDialogTitle")} onClick={() => { setSelectedKey(key); setViewKeyDialogOpen(true) }}>
                                    <Eye className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                      handleCopyToClipboard(
                                        key.public_key,
                                        tAccount("sshPublicKeyLabel"),
                                      )
                                    }
                                  >
                                    <Copy className="h-4 w-4" />
                                    {tAccount("sshCopyPublicKeyButton")}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    aria-label={tAccount("sshDeleteKeyButton")}
                                    title={tAccount("sshDeleteKeyButton")}
                                    onClick={() => handleDeleteKey(key.id, key.name)}
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 生成密钥对话框 */}
                    <Dialog open={generateDialogOpen} onOpenChange={setGenerateDialogOpen}>
                      <DialogContent className="min-w-0 grid-cols-[minmax(0,1fr)] max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
                        <DialogTitle>{tAccount("sshGenerateDialogTitle")}</DialogTitle>
                        <DialogDescription>
                          {tAccount("sshGenerateDialogDescription")}
                        </DialogDescription>
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="gen-name">
                              {tAccount("sshGenerateNameLabel")}
                            </Label>
                            <Input
                              id="gen-name"
                              placeholder={tAccount("sshGenerateNamePlaceholder")}
                              value={generateForm.name}
                              onChange={(e) =>
                                setGenerateForm({ ...generateForm, name: e.target.value })
                              }
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="gen-algorithm">
                              {tAccount("sshGenerateAlgorithmLabel")}
                            </Label>
                            <Select
                              value={generateForm.algorithm}
                              onValueChange={(value: "rsa" | "ed25519") =>
                                setGenerateForm({ ...generateForm, algorithm: value })
                              }
                            >
                              <SelectTrigger id="gen-algorithm">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="ed25519">
                                  {tAccount("sshGenerateAlgorithmOptionEd25519")}
                                </SelectItem>
                                <SelectItem value="rsa">
                                  {tAccount("sshGenerateAlgorithmOptionRsa")}
                                </SelectItem>
                              </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                              {tAccount("sshGenerateAlgorithmEd25519Hint")}
                            </p>
                          </div>
                          {generateForm.algorithm === "rsa" && (
                            <div className="space-y-2">
                              <Label htmlFor="gen-keysize">
                                {tAccount("sshGenerateKeySizeLabel")}
                              </Label>
                              <Select
                                value={generateForm.key_size.toString()}
                                onValueChange={(value) =>
                                  setGenerateForm({
                                    ...generateForm,
                                    key_size: parseInt(value),
                                  })
                                }
                              >
                                <SelectTrigger id="gen-keysize">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="2048">
                                    {tAccount("sshGenerateKeySizeOption2048")}
                                  </SelectItem>
                                  <SelectItem value="4096">
                                    {tAccount("sshGenerateKeySizeOption4096")}
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              onClick={() => setGenerateDialogOpen(false)}
                              disabled={generateLoading}
                            >
                              {tAccount("sshDialogCancel")}
                            </Button>
                            <Button onClick={handleGenerateKey} disabled={generateLoading}>
                              {generateLoading && (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              )}
                              {tAccount("sshGenerateSubmit")}
                            </Button>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>

                    {/* 导入密钥对话框 */}
                    <Dialog open={importDialogOpen} onOpenChange={open => { if (importLoading) return; setImportDialogOpen(open); if (!open) setImportForm({ name: "", private_key: "", passphrase: "" }) }}>
                      <DialogContent className="min-w-0 grid-cols-[minmax(0,1fr)] max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
                        <DialogTitle>{tAccount("sshImportDialogTitle")}</DialogTitle>
                        <DialogDescription>
                          {tAccount("sshImportDialogDescription")}
                        </DialogDescription>
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label htmlFor="imp-name">
                              {tAccount("sshImportNameLabel")}
                            </Label>
                            <Input
                              id="imp-name"
                              disabled={importLoading}
                              placeholder={tAccount("sshImportNamePlaceholder")}
                              value={importForm.name}
                              onChange={(e) =>
                                setImportForm({ ...importForm, name: e.target.value })
                              }
                            />
                          </div>
                          <div className="space-y-2">
                            <PrivateKeyInput
                              id="imp-key"
                              label={tAccount("sshImportPrivateKeyLabel")}
                              placeholder={tAccount("sshImportPrivateKeyPlaceholder")}
                              value={importForm.private_key}
                              disabled={importLoading}
                              onChange={private_key => setImportForm({ ...importForm, private_key })}
                            />
                            <p className="text-xs text-muted-foreground">
                              {tAccount("sshImportPrivateKeyHint")}
                            </p>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="imp-passphrase">{tServers("keyPassphraseLabel")}</Label>
                            <Input id="imp-passphrase" disabled={importLoading} type="password" autoComplete="off" data-bwignore="true" value={importForm.passphrase} onChange={e => setImportForm({ ...importForm, passphrase: e.target.value })} />
                            <p className="text-xs text-muted-foreground">{tServers("keyPassphraseHint")}</p>
                          </div>
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              onClick={() => { setImportDialogOpen(false); setImportForm({ name: "", private_key: "", passphrase: "" }) }}
                              disabled={importLoading}
                            >
                              {tAccount("sshDialogCancel")}
                            </Button>
                            <Button onClick={handleImportKey} disabled={importLoading}>
                              {importLoading && (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              )}
                              {tAccount("sshImportSubmit")}
                            </Button>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>

                    {/* 已有密钥展示公钥；新生成密钥同时展示一次性私钥。 */}
                    <Dialog open={viewKeyDialogOpen} onOpenChange={open => { setViewKeyDialogOpen(open); if (!open) setSelectedKey(null) }}>
                      <DialogContent className="min-w-0 grid-cols-[minmax(0,1fr)] max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
                        <DialogTitle>{tAccount("sshViewDialogTitle")}</DialogTitle>
                        <DialogDescription>
                          {tAccount(selectedKey && "private_key" in selectedKey ? "sshViewDialogDescription" : "sshPublicKeyDescription")}
                        </DialogDescription>
                        {selectedKey && (
                          <div className="space-y-4">
                            <div className="min-w-0 space-y-1">
                              <p className="break-words font-medium">{selectedKey.name}</p>
                              <p className="text-xs text-muted-foreground">{selectedKey.algorithm.toUpperCase()}{selectedKey.key_size ? ` ${selectedKey.key_size}` : ""}</p>
                              <p className="break-all font-mono text-xs text-muted-foreground">{selectedKey.fingerprint}</p>
                            </div>
                            <div className="space-y-2">
                              <div className="flex justify-between items-center">
                                <Label>{tAccount("sshViewPublicKeyLabel")}</Label>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    handleCopyToClipboard(
                                      selectedKey.public_key,
                                      tAccount("sshPublicKeyLabel"),
                                    )
                                  }
                                >
                                  <Copy className="h-4 w-4 mr-1" />
                                  {tAccount("sshCopyButtonLabel")}
                                </Button>
                              </div>
                              <Textarea
                                className="min-w-0 field-sizing-fixed min-h-[80px] font-mono text-xs md:text-xs"
                                value={selectedKey.public_key}
                                readOnly
                              />
                            </div>
                            {"private_key" in selectedKey && <><div className="space-y-2">
                              <div className="flex justify-between items-center">
                                <Label>{tAccount("sshViewPrivateKeyLabel")}</Label>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    handleCopyToClipboard(
                                      selectedKey.private_key,
                                      tAccount("sshPrivateKeyLabel"),
                                    )
                                  }
                                >
                                  <Copy className="h-4 w-4 mr-1" />
                                  {tAccount("sshCopyButtonLabel")}
                                </Button>
                              </div>
                              <Textarea
                                className="min-w-0 field-sizing-fixed min-h-[200px] font-mono text-xs md:text-xs"
                                value={selectedKey.private_key}
                                readOnly
                              />
                            </div>
                            <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded p-3">
                              <p className="text-sm text-amber-800 dark:text-amber-200">
                                {tAccount("sshViewPrivateKeyWarning")}
                              </p>
                            </div></>}
                            <div className="flex justify-end">
                              <Button
                                onClick={() => {
                                  setViewKeyDialogOpen(false)
                                  setSelectedKey(null)
                                }}
                              >
                                {tAccount("private_key" in selectedKey ? "sshViewIHaveSavedButton" : "sshViewCloseButton")}
                              </Button>
                            </div>
                          </div>
                        )}
                      </DialogContent>
                    </Dialog>
                  </div></>)
}
