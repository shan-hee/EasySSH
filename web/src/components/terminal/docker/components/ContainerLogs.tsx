/**
 * 容器日志查看对话框
 */

import { useEffect, useState, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RefreshCw, Loader2 } from 'lucide-react'
import type { DockerApiClient } from '@/lib/api/docker'
import { useTranslation } from "react-i18next"
import { FileEditor } from '@/components/sftp/file-editor'

interface ContainerLogsProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  serverId: string
  containerId: string
  containerName: string
  dockerClient: DockerApiClient
}

export function ContainerLogs({
  open,
  onOpenChange,
  serverId,
  containerId,
  containerName,
  dockerClient,
}: ContainerLogsProps) {
  const { t } = useTranslation('terminal')
  const [logs, setLogs] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [tailLines, setTailLines] = useState(200)
  const [encoding, setEncoding] = useState("utf-8")

  // 加载日志
  const fetchLogs = useCallback(async () => {
    if (!containerId) return
    setLoading(true)
    try {
      const res = await dockerClient.getContainerLogs(serverId, containerId, tailLines, encoding)
      setLogs(res.data)
    } catch (error) {
      setLogs(`Error loading logs: ${error}`)
    } finally {
      setLoading(false)
    }
  }, [containerId, dockerClient, encoding, serverId, tailLines])

  // 下载日志
  const downloadLogs = () => {
    const blob = new Blob([logs], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${containerName}-logs.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  // 打开时加载
  useEffect(() => {
    if (open && containerId) {
      fetchLogs()
    }
  }, [open, containerId, fetchLogs])

  const displayContent = logs || (loading ? t('dockerLogsLoading') : t('dockerNoLogs'))
  const fileName = `${containerName}-logs.log`

  return (
    <Dialog modal={false} open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[80vh] max-h-[720px] max-w-[calc(100%-2rem)] flex-col overflow-hidden p-0 sm:max-w-[1100px]"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t('dockerLogsTitle', { name: containerName })}</DialogTitle>
          <DialogDescription>{t('dockerLogsEditorDescription')}</DialogDescription>
        </DialogHeader>

        <FileEditor
          fileName={fileName}
          filePath={`/docker/containers/${containerId}/${fileName}`}
          fileContent={displayContent}
          isOpen={open}
          onClose={() => onOpenChange(false)}
          onSave={() => undefined}
          onDownload={logs ? downloadLogs : undefined}
          readOnly
          closeButtonLabel={t('dockerLogsClose')}
          scrollToBottomOnContentChange
          encoding={encoding}
          onEncodingChange={setEncoding}
          toolbarActions={
            <>
              <Select value={String(tailLines)} onValueChange={(value) => setTailLines(Number(value))}>
                <SelectTrigger
                  aria-label={t('dockerLogsTailLines')}
                  className="h-7 w-[104px] rounded border-border bg-background px-2 text-xs"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="100">100 lines</SelectItem>
                  <SelectItem value="200">200 lines</SelectItem>
                  <SelectItem value="500">500 lines</SelectItem>
                  <SelectItem value="1000">1000 lines</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={fetchLogs}
                disabled={loading}
                title={t('dockerLogsRefresh')}
                aria-label={t('dockerLogsRefresh')}
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
              </Button>
            </>
          }
        />
      </DialogContent>
    </Dialog>
  )
}
