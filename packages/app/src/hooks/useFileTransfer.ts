import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sftpApi } from '@/lib/api/sftp';
import { getOptionalPlatformTransport } from '@/contracts/platform-transport';
import { usePlatformCredentials } from '@/hooks/use-platform-credentials';
import type { TransferJob } from '@/lib/transfer-job-types';
import {
  createFileTransferController,
  type FileTransferSftpApi,
} from '@/lib/session/transfer-manager-controller';
import type { TransferTask, TransferTaskUpdate } from '@/lib/session/transfer-tasks';
import {
  createTransferConcurrencyLimiter,
  type TransferConcurrencyLimiter,
} from '@/lib/session/transfer-runtime';

export type { TransferTask }
export type { FileTransferSftpApi }

export interface UseFileTransferOptions {
  api?: FileTransferSftpApi;
  uploadLimiter?: TransferConcurrencyLimiter;
  /** 页面刷新后由本实例接管的未结束任务；不提供则不恢复。 */
  restore?: (job: TransferJob) => boolean;
}

/**
 * 文件传输 Hook。
 * React 只负责状态持有和登录态触发，传输流程由 session transfer controller 承接。
 */
export function useFileTransfer({
  api = sftpApi,
  uploadLimiter: providedUploadLimiter,
  restore,
}: UseFileTransferOptions = {}) {
  // 未注入平台传输即桌面本机工作区，传输由本机服务提供，无需等待登录凭据。
  const transportReady = usePlatformCredentials() || getOptionalPlatformTransport() === null;
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  const [tasks, setTasks] = useState<TransferTask[]>([]);
  const tasksRef = useRef<TransferTask[]>(tasks);
  tasksRef.current = tasks;

  const defaultUploadLimiterRef = useRef<TransferConcurrencyLimiter | null>(null);
  const defaultUploadLimiter = defaultUploadLimiterRef.current ?? createTransferConcurrencyLimiter();
  if (!defaultUploadLimiterRef.current) {
    defaultUploadLimiterRef.current = defaultUploadLimiter;
  }
  const uploadLimiter = providedUploadLimiter ?? defaultUploadLimiter;

  const updateTransferTasks = useCallback((updater: (tasks: readonly TransferTask[]) => TransferTask[]) => {
    setTasks((current) => updater(current));
  }, []);

  const controller = useMemo(() => createFileTransferController({
    api,
    uploadLimiter,
    getTasks: () => tasksRef.current,
    setTasks: updateTransferTasks,
    logWarn: (message, ...args) => {
      console.warn(message.replace('[transfer-manager]', '[useFileTransfer]'), ...args);
    },
  }), [api, uploadLimiter, updateTransferTasks]);

  const restoreEnabled = !!restore;
  useEffect(() => {
    if (!transportReady || !restoreEnabled) {
      return;
    }

    let cancelled = false;
    void controller.restoreTransfers({
      owns: (job) => restoreRef.current?.(job) ?? false,
      shouldSkip: () => cancelled,
    }).catch((err) => {
      console.warn('[useFileTransfer] Failed to restore transfers:', err);
    });

    return () => {
      cancelled = true;
    };
  }, [transportReady, restoreEnabled, controller]);

  const updateTask = useCallback((taskId: string, update: TransferTaskUpdate) => {
    controller.updateTask(taskId, update);
  }, [controller]);

  return {
    tasks,
    downloadFile: controller.downloadFile,
    batchDownload: controller.batchDownload,
    uploadFile: controller.uploadFile,
    cancelTask: controller.cancelTask,
    removeTask: controller.removeTask,
    retryTask: controller.retryTask,
    clearAll: controller.clearAll,
    updateTask,
    directTransfer: controller.directTransfer,
  };
}
