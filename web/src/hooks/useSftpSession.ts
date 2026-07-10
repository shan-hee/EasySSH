
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { sftpApi, type FileInfo } from '@/lib/api/sftp';
import { useFileTransfer, type FileTransferSftpApi, type UseFileTransferOptions } from './useFileTransfer';
import { getErrorMessage } from "@/lib/error-utils";
import { convertSftpFileInfo, type SftpFileItem } from "@/lib/sftp-file-utils";
import { loadSftpDirectory } from "@/lib/session/sftp-directory";
import {
  performBatchDelete,
  performCreateFile,
  performCreateFolder,
  performDelete,
  performRename,
  performSaveFile,
  type SftpOperationNotifier,
  type TranslateFunction,
} from "@/lib/session/sftp-operations";
import {
  createSftpSessionApi,
  type SftpSessionApi,
  type SftpSessionApiAdapter,
} from "@/lib/session/sftp-session-api";
import type { SshWorkspaceTransferManager } from "@/lib/session/workspace";
import type { TerminalAuthMethod } from "@/lib/websocket-terminal";

type SftpAuthMethod = TerminalAuthMethod;
type SftpCredentialRetryRunner = <T>(options: {
  serverId: string;
  serverName: string;
  authMethod: SftpAuthMethod;
  api: Pick<SftpSessionApi, "authenticate" | "preAuthenticate">;
  operation: () => Promise<T>;
}) => Promise<T>;

/**
 * SFTP会话状态
 */
export interface SftpSessionState {
  serverId: string;
  currentPath: string;
  files: FileItem[];
  isLoading: boolean;
  error: string | null;
}

/**
 * 文件项接口(用于UI显示)
 */
export type FileItem = SftpFileItem;

/**
 * 简化版文件项接口(SFTP页面使用)
 * 与 FileItem 的主要区别是没有 sizeBytes 字段
 */
export interface SimpleFileItem {
  name: string;
  type: 'file' | 'directory';
  size: string;
  modified: string;
  permissions: string;
}

export interface SftpSessionNotifier extends SftpOperationNotifier {
  success: (message: string) => unknown;
  error: (message: string) => unknown;
}

export interface UseSftpSessionOptions {
  api?: SftpSessionApiAdapter;
  notifier?: SftpSessionNotifier;
  t?: TranslateFunction;
  fileTransferOptions?: UseFileTransferOptions;
  transferManager?: SshWorkspaceTransferManager;
  initialPathBackStack?: string[];
  initialPathForwardStack?: string[];
  serverName?: string;
  authMethod?: SftpAuthMethod;
  runWithCredentialRetry?: SftpCredentialRetryRunner;
  onHistoryChange?: (history: {
    currentPath: string;
    pathBackStack: string[];
    pathForwardStack: string[];
  }) => void;
}

const defaultSessionNotifier: SftpSessionNotifier = {
  success: () => undefined,
  error: () => undefined,
  promise: <T,>(promise: Promise<T>, messages: {
    loading: string;
    success: string | ((data: T) => string);
    error: string | ((error: unknown) => string);
  }) => {
    void messages;
    void promise.catch(() => undefined);
    return promise;
  },
};

function isFileTransferSftpApi(candidate: unknown): candidate is FileTransferSftpApi {
  if (!candidate || typeof candidate !== "object") {
    return false;
  }

  const api = candidate as Partial<Record<keyof FileTransferSftpApi, unknown>>;
  return (
    typeof api.createUploadTask === "function" &&
    typeof api.listUploadTasks === "function" &&
    typeof api.cancelUploadTask === "function" &&
    typeof api.uploadFile === "function" &&
    typeof api.directTransfer === "function" &&
    typeof api.cancelTransfer === "function"
  );
}

/**
 * useSftpSession Hook
 * 管理SFTP会话的状态和操作
 */
export function useSftpSession(
  serverId: string,
  initialPath: string = '/',
  {
    api,
    notifier,
    t,
    fileTransferOptions,
    transferManager,
    initialPathBackStack = [],
    initialPathForwardStack = [],
    serverName = serverId,
    authMethod = "password",
    runWithCredentialRetry,
    onHistoryChange,
  }: UseSftpSessionOptions = {}
) {
  const defaultTranslate: TranslateFunction = (key) => key;
  const tSftp = t ?? defaultTranslate;
  const sessionNotifier = notifier ?? defaultSessionNotifier;
  const sessionApi = useMemo(() => createSftpSessionApi(api), [api]);
  const [currentPath, setCurrentPath] = useState(initialPath);
  const currentPathRef = useRef(initialPath);
  const loadedServerRef = useRef<string | null>(null);
  const [pathBackStack, setPathBackStack] = useState<string[]>(() => initialPathBackStack);
  const [pathForwardStack, setPathForwardStack] = useState<string[]>(() => initialPathForwardStack);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSftpOperation = useCallback(<T,>(operation: () => Promise<T>) => {
    if (!runWithCredentialRetry) {
      return operation();
    }

    return runWithCredentialRetry({
      serverId,
      serverName,
      authMethod,
      api: sessionApi,
      operation,
    });
  }, [authMethod, runWithCredentialRetry, serverId, serverName, sessionApi]);

  const fileTransferApi = useMemo<FileTransferSftpApi>(() => {
    const candidateApi = fileTransferOptions?.api ?? api;
    const baseApi = isFileTransferSftpApi(candidateApi) ? candidateApi : sftpApi;

    return {
      ...baseApi,
      downloadFile: baseApi.downloadFile
        ? (targetServerId, path, taskId) => (
            runSftpOperation(() => Promise.resolve(baseApi.downloadFile!(targetServerId, path, taskId)))
          )
        : undefined,
      batchDownload: baseApi.batchDownload
        ? (targetServerId, paths, mode, excludePatterns, taskId) => (
            runSftpOperation(() => baseApi.batchDownload!(targetServerId, paths, mode, excludePatterns, taskId))
          )
        : undefined,
      uploadFile: (targetServerId, path, file, onProgress, wsTaskId, onXhr) => (
        runSftpOperation(() => baseApi.uploadFile(targetServerId, path, file, onProgress, wsTaskId, onXhr))
      ),
    };
  }, [api, fileTransferOptions?.api, runSftpOperation]);

  const effectiveFileTransferOptions = useMemo<UseFileTransferOptions>(() => ({
    ...fileTransferOptions,
    api: fileTransferApi,
  }), [fileTransferApi, fileTransferOptions]);

  const internalFileTransfer = useFileTransfer(effectiveFileTransferOptions);
  const uploadFileWithCredentialRetry = transferManager?.uploadFile
    ? (...args: Parameters<NonNullable<SshWorkspaceTransferManager["uploadFile"]>>) => (
        runSftpOperation(() => Promise.resolve(transferManager.uploadFile!(...args)))
      )
    : internalFileTransfer.uploadFile;
  const downloadFileWithCredentialRetry = transferManager?.downloadFile
    ? (...args: Parameters<NonNullable<SshWorkspaceTransferManager["downloadFile"]>>) => (
        runSftpOperation(() => Promise.resolve(transferManager.downloadFile!(...args)))
      )
    : internalFileTransfer.downloadFile;
  const batchDownloadWithCredentialRetry = transferManager?.batchDownload
    ? (...args: Parameters<NonNullable<SshWorkspaceTransferManager["batchDownload"]>>) => (
        runSftpOperation(() => transferManager.batchDownload!(...args))
      )
    : internalFileTransfer.batchDownload;
  const fileTransfer = {
    tasks: transferManager?.tasks ?? internalFileTransfer.tasks,
    uploadFile: uploadFileWithCredentialRetry,
    downloadFile: downloadFileWithCredentialRetry,
    batchDownload: batchDownloadWithCredentialRetry,
    cancelTask: transferManager?.cancelTask ?? internalFileTransfer.cancelTask,
    removeTask: transferManager?.removeTask ?? internalFileTransfer.removeTask,
    clearCompleted: transferManager?.clearCompleted ?? internalFileTransfer.clearCompleted,
  };

  const operationApi = useMemo<SftpSessionApi>(() => ({
    ...sessionApi,
    delete: (targetServerId, path) => runSftpOperation(() => sessionApi.delete(targetServerId, path)),
    deletePaths: (targetServerId, paths) => runSftpOperation(() => sessionApi.deletePaths(targetServerId, paths)),
    createDirectory: (targetServerId, path) => (
      runSftpOperation(() => sessionApi.createDirectory(targetServerId, path))
    ),
    writeFile: (targetServerId, path, content) => (
      runSftpOperation(() => sessionApi.writeFile(targetServerId, path, content))
    ),
    rename: (targetServerId, oldPath, newPath) => (
      runSftpOperation(() => sessionApi.rename(targetServerId, oldPath, newPath))
    ),
    batchDelete: (targetServerId, paths) => (
      runSftpOperation(() => sessionApi.batchDelete(targetServerId, paths))
    ),
    downloadFile: (targetServerId, path) => (
      runSftpOperation(() => Promise.resolve(sessionApi.downloadFile(targetServerId, path)))
    ),
    readFile: (targetServerId, path) => runSftpOperation(() => sessionApi.readFile(targetServerId, path)),
    batchDownload: (targetServerId, paths, mode, excludePatterns) => (
      runSftpOperation(() => sessionApi.batchDownload(targetServerId, paths, mode, excludePatterns))
    ),
    chmod: sessionApi.chmod
      ? (targetServerId, path, mode) => (
          runSftpOperation(() => sessionApi.chmod!(targetServerId, path, mode))
        )
      : undefined,
  }), [runSftpOperation, sessionApi]);

  /**
   * 转换后端FileInfo为前端FileItem
   */
  const convertFileInfo = useCallback((info: FileInfo): FileItem => {
    const converted = convertSftpFileInfo(info, {
      // 终端文件管理器默认显示目录 size 为 "-"
      showDirSizeDash: true,
    }) satisfies SftpFileItem
    return converted
  }, []);

  /**
   * 加载目录内容
   */
  const loadDirectory = useCallback(async (path: string) => {
    if (!serverId) return;

    setIsLoading(true);
    setError(null);

    try {
      const directory = await runSftpOperation(() => loadSftpDirectory({
        serverId,
        path,
        convertFileInfo,
        withParentEntry: false,
        api: sessionApi,
      }));

      setFiles(directory.files);
      setCurrentPath(directory.path);
      currentPathRef.current = directory.path;
      return directory.path;
    } catch (err: unknown) {
      console.error('[useSftpSession] 加载目录失败:', err);
      const errorMessage = err instanceof Error ? err.message : '加载目录失败';
      setError(errorMessage);
      setFiles([]);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [serverId, convertFileInfo, runSftpOperation, sessionApi]);

  /**
   * 导航到指定路径
   */
  const navigate = useCallback(
    async (path: string) => {
      const previousPath = currentPathRef.current;
      const loadedPath = await loadDirectory(path);

      if (loadedPath && loadedPath !== previousPath) {
        setPathBackStack((prev) => [...prev, previousPath].slice(-50));
        setPathForwardStack([]);
      }
    },
    [loadDirectory]
  );

  /**
   * 回到本会话内上一次访问的目录
   */
  const goBack = useCallback(async () => {
    const previousPath = pathBackStack[pathBackStack.length - 1];
    if (!previousPath) return;

    const current = currentPathRef.current;
    const loadedPath = await loadDirectory(previousPath);
    if (!loadedPath) return;

    setPathBackStack((prev) => prev.slice(0, -1));
    if (loadedPath !== current) {
      setPathForwardStack((prev) => [...prev, current].slice(-50));
    }
  }, [loadDirectory, pathBackStack]);

  /**
   * 前进到本会话内下一次访问的目录
   */
  const goForward = useCallback(async () => {
    const nextPath = pathForwardStack[pathForwardStack.length - 1];
    if (!nextPath) return;

    const current = currentPathRef.current;
    const loadedPath = await loadDirectory(nextPath);
    if (!loadedPath) return;

    setPathForwardStack((prev) => prev.slice(0, -1));
    if (loadedPath !== current) {
      setPathBackStack((prev) => [...prev, current].slice(-50));
    }
  }, [loadDirectory, pathForwardStack]);

  /**
   * 刷新当前目录
   */
  const refresh = useCallback(() => {
    loadDirectory(currentPath);
  }, [currentPath, loadDirectory]);

  /**
   * 上传文件
   */
  const uploadFiles = useCallback(
    async (fileList: FileList, onProgress?: (fileName: string, loaded: number, total: number) => void) => {
      // 这里仍采用“上传完成后整目录刷新”的策略:
      // - 上传往往会在目录中引入多个新文件,且用户可能在上传过程中切换目录
      // - 为保证列表与服务器完全一致,这里保留一次性刷新,其他操作则采用差异更新
      const uploadPromises: Promise<unknown>[] = [];

      for (const file of Array.from(fileList)) {
        const promise = fileTransfer.uploadFile(
          serverId,
          currentPath,
          file,
          onProgress ? (loaded, total) => onProgress(file.name, loaded, total) : undefined,
          true // 启用 WebSocket 进度跟踪
        );
        uploadPromises.push(promise);
      }

      try {
        await Promise.all(uploadPromises);
        // 上传完成后刷新当前目录
        refresh();
        // 上传成功提示（与 SFTP 页面保持一致风格）
        if (fileList.length > 0) {
          sessionNotifier.success(
            tSftp("toastUploadSuccess", { count: fileList.length })
          );
        }
      } catch (error) {
        console.error('[useSftpSession] 上传失败:', error);
        sessionNotifier.error(getErrorMessage(error, tSftp("toastUploadFailed", { count: fileList.length })));
        throw error;
      }
    },
    [serverId, currentPath, fileTransfer, refresh, sessionNotifier, tSftp]
  );

  /**
   * 下载文件
   */
  const downloadFile = useCallback(
    async (fileName: string) => {
      const file = files.find((f) => f.name === fileName);
      if (!file || file.type === 'directory') return;

      const fullPath = currentPath.endsWith('/')
        ? `${currentPath}${fileName}`
        : `${currentPath}/${fileName}`;

      try {
        await fileTransfer.downloadFile(serverId, fullPath, fileName);
        sessionNotifier.success(tSftp("toastDownloadStartSingle", { file: fileName }));
      } catch (error) {
        console.error('[useSftpSession] 下载失败:', error);
        sessionNotifier.error(getErrorMessage(error, tSftp("toastDownloadFailed")));
      }
    },
    [serverId, currentPath, files, fileTransfer, sessionNotifier, tSftp]
  );

  /**
   * 删除文件或目录 (使用通用函数)
   */
  const deleteFile = useCallback(
    (fileName: string, isDirectory: boolean) => performDelete({
      serverId,
      currentPath,
      fileName,
      isDirectory,
      t: tSftp,
      notifier: sessionNotifier,
      setFiles,
      api: operationApi,
    }),
    [serverId, currentPath, operationApi, sessionNotifier, tSftp]
  );

  /**
   * 创建文件夹 (使用通用函数)
   */
  const createFolder = useCallback(
    (name: string) => performCreateFolder({
      serverId,
      currentPath,
      name,
      t: tSftp,
      notifier: sessionNotifier,
      setFiles,
      convertFileInfo,
      api: operationApi,
    }),
    [serverId, currentPath, convertFileInfo, operationApi, sessionNotifier, tSftp]
  );

  /**
   * 创建文件 (使用通用函数)
   */
  const createFile = useCallback(
    (name: string) => performCreateFile({
      serverId,
      currentPath,
      name,
      t: tSftp,
      notifier: sessionNotifier,
      setFiles,
      convertFileInfo,
      api: operationApi,
    }),
    [serverId, currentPath, convertFileInfo, operationApi, sessionNotifier, tSftp]
  );

  /**
   * 重命名文件或目录 (使用通用函数)
   */
  const renameFile = useCallback(
    (oldName: string, newName: string) => performRename({
      serverId,
      currentPath,
      oldName,
      newName,
      t: tSftp,
      notifier: sessionNotifier,
      setFiles,
      api: operationApi,
    }),
    [serverId, currentPath, operationApi, sessionNotifier, tSftp]
  );

  /**
   * 读取文件内容
   */
  const readFile = useCallback(
    async (fileName: string): Promise<string> => {
      try {
        const fullPath = currentPath.endsWith('/')
          ? `${currentPath}${fileName}`
          : `${currentPath}/${fileName}`;

        const content = await operationApi.readFile(serverId, fullPath);

        return content;
      } catch (error) {
        console.error('[useSftpSession] 读取文件失败:', error);
        sessionNotifier.error(getErrorMessage(error, tSftp("toastReadFileFailed")));
        throw error;
      }
    },
    [serverId, currentPath, operationApi, sessionNotifier, tSftp]
  );

  /**
   * 保存文件内容 (使用通用函数)
   */
  const saveFile = useCallback(
    (fileName: string, content: string) => performSaveFile({
      serverId,
      currentPath,
      fileName,
      content,
      t: tSftp,
      notifier: sessionNotifier,
      setFiles,
      convertFileInfo,
      api: operationApi,
    }),
    [serverId, currentPath, convertFileInfo, operationApi, sessionNotifier, tSftp]
  );

  /**
   * 批量删除文件或目录 (使用通用函数)
   */
  const batchDeleteFiles = useCallback(
    (fileNames: string[], hasDirectory: boolean) => performBatchDelete({
      serverId,
      currentPath,
      fileNames,
      hasDirectory,
      t: tSftp,
      notifier: sessionNotifier,
      setFiles,
      api: operationApi,
    }),
    [serverId, currentPath, operationApi, sessionNotifier, tSftp]
  );

  /**
   * 批量下载文件（终端/文件管理器固定使用推荐的快速下载方案）
   */
  const batchDownloadFiles = useCallback(
    async (fileNames: string[], excludePatterns?: string[]) => {
      try {
        // 构建完整路径
        const fullPaths = fileNames.map((fileName) =>
          currentPath.endsWith('/')
            ? `${currentPath}${fileName}`
            : `${currentPath}/${fileName}`
        );

        await fileTransfer.batchDownload(serverId, fullPaths, "fast", excludePatterns);
        sessionNotifier.success(
          tSftp("toastBatchDownloadStart", { count: fileNames.length })
        );
      } catch (error) {
        console.error('[useSftpSession] 批量下载失败:', error);
        sessionNotifier.error(getErrorMessage(error, tSftp("toastBatchDownloadFailed")));
        throw error;
      }
    },
    [serverId, currentPath, fileTransfer, sessionNotifier, tSftp]
  );

  // 初始加载。initialPath 只作为挂载/切换服务器时的初值，避免父级同步当前路径时清空历史栈。
  useEffect(() => {
    if (!serverId || loadedServerRef.current === serverId) return;
    loadedServerRef.current = serverId;
    currentPathRef.current = initialPath;
    setCurrentPath(initialPath);
    setPathBackStack(initialPathBackStack);
    setPathForwardStack(initialPathForwardStack);
    void loadDirectory(initialPath);
  }, [serverId, initialPath, initialPathBackStack, initialPathForwardStack, loadDirectory]);

  useEffect(() => {
    onHistoryChange?.({
      currentPath,
      pathBackStack,
      pathForwardStack,
    });
  }, [currentPath, onHistoryChange, pathBackStack, pathForwardStack]);

  // 页面卸载/切换 serverId 时，主动关闭连接以加速资源回收
  useEffect(() => {
    if (!serverId) return;
    return () => {
      sessionApi.closeConnection?.(serverId)?.catch(() => {
        // cleanup 阶段不打扰用户；失败时等待后端空闲回收即可
      });
    };
  }, [serverId, sessionApi]);

  return {
    // 状态
    currentPath,
    files,
    isLoading,
    error,
    transferTasks: fileTransfer.tasks,
    pathBackStack,
    pathForwardStack,
    canGoBack: pathBackStack.length > 0,
    canGoForward: pathForwardStack.length > 0,

    // 操作
    navigate,
    goBack,
    goForward,
    refresh,
    uploadFiles,
    downloadFile,
    deleteFile,
    createFolder,
    createFile,
    renameFile,
    readFile,
    saveFile,

    // 批量操作
    batchDeleteFiles,
    batchDownloadFiles,

    // 传输管理
    cancelTransfer: fileTransfer.cancelTask,
    removeTransfer: fileTransfer.removeTask,
    clearCompletedTransfers: fileTransfer.clearCompleted,
  };
}
