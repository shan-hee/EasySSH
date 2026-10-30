
import { useState, useCallback, useEffect, useEffectEvent, useMemo, useRef } from 'react';
import { QueryClient, isCancelledError } from '@tanstack/react-query';
import type { FileInfo } from '@/lib/api/sftp';
import { useFileTransfer, type FileTransferSftpApi, type UseFileTransferOptions } from './useFileTransfer';
import { isApiError } from "@/lib/api-client";
import { getErrorMessage } from "@/lib/error-utils";
import { convertSftpFileInfo, resolveSftpNavigationPath, sftpRemoteBaseName, type SftpFileItem } from "@/lib/sftp-file-utils";
import { createSftpDirectorySource, sftpParentPath, type SftpDirectoryLease } from "@/lib/session/sftp-directory-source";
import { loadSftpDirectory, type LoadedSftpDirectory } from "@/lib/session/sftp-directory";
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
  assertCompleteSftpSessionApi,
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
  const sessionApi = useMemo(() => {
    const resolved = createSftpSessionApi(api);
    assertCompleteSftpSessionApi(resolved, "SFTP session file transfer");
    return resolved;
  }, [api]);
  // 缓存随面板/连接身份销毁，避免不同凭据或产品适配器之间共享目录。
  const directoryCache = useMemo(() => new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 5 * 60_000 } },
  }), [serverId, sessionApi]);
  const activeDirectoryRequest = useRef<{ path: string; promise: Promise<string | null>; lease: SftpDirectoryLease } | null>(null);
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [failedPath, setFailedPath] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState(initialPath);
  const currentPathRef = useRef(initialPath);
  const directoryRequestVersion = useRef(0);
  const navigationVersion = useRef(0);
  const [isConnected, setIsConnected] = useState(false);
  const loadedServerRef = useRef<string | null>(null);
  const loadedCacheRef = useRef<QueryClient | null>(null);
  const [pathBackStack, setPathBackStack] = useState<string[]>(() => initialPathBackStack);
  const [pathForwardStack, setPathForwardStack] = useState<string[]>(() => initialPathForwardStack);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loadingPresentation, setLoadingPresentation] = useState<"overlay" | "path" | null>(serverId ? "overlay" : null);
  const isLoading = loadingPresentation !== null;
  const [error, setError] = useState<string | null>(null);

  const runSftpOperation = useCallback(<T,>(operation: () => Promise<T>) => {
    if (!runWithCredentialRetry) {
      return operation();
    }

    let attempted = false;
    return runWithCredentialRetry({
      serverId,
      serverName,
      authMethod,
      api: sessionApi,
      operation: () => {
        if (attempted) void directoryCache.invalidateQueries({ refetchType: "none" });
        attempted = true;
        return operation();
      },
    });
  }, [authMethod, runWithCredentialRetry, serverId, serverName, sessionApi, directoryCache]);

  const fileTransferApi = useMemo<FileTransferSftpApi>(() => {
    // 页面只提供完整的会话 API；上传、下载和任务查询不能再由各产品壳自行裁剪。
    // 启动传输需要可用的 SFTP 认证，失败时走与目录浏览相同的凭据重试。
    const baseApi = fileTransferOptions?.api ?? sessionApi;

    return {
      ...baseApi,
      downloadFile: (targetServerId, path, options) => (
        runSftpOperation(() => baseApi.downloadFile(targetServerId, path, options))
      ),
      batchDownload: (targetServerId, paths, excludePatterns, options) => (
        runSftpOperation(() => baseApi.batchDownload(targetServerId, paths, excludePatterns, options))
      ),
      uploadFile: (targetServerId, path, file, options) => (
        runSftpOperation(() => baseApi.uploadFile(targetServerId, path, file, options))
      ),
    };
  }, [fileTransferOptions?.api, runSftpOperation, sessionApi]);

  const effectiveFileTransferOptions = useMemo<UseFileTransferOptions>(() => ({
    ...fileTransferOptions,
    api: fileTransferApi,
  }), [fileTransferApi, fileTransferOptions]);

  const internalFileTransfer = useFileTransfer(effectiveFileTransferOptions);
  const fileTransfer = useMemo(() => ({
    tasks: transferManager?.tasks ?? internalFileTransfer.tasks,
    uploadFile: transferManager?.uploadFile
      ? (...args: Parameters<NonNullable<SshWorkspaceTransferManager["uploadFile"]>>) => (
          runSftpOperation(() => Promise.resolve(transferManager.uploadFile!(...args)))
        )
      : internalFileTransfer.uploadFile,
    downloadFile: transferManager?.downloadFile
      ? (...args: Parameters<NonNullable<SshWorkspaceTransferManager["downloadFile"]>>) => (
          runSftpOperation(() => Promise.resolve(transferManager.downloadFile!(...args)))
        )
      : internalFileTransfer.downloadFile,
    batchDownload: transferManager?.batchDownload
      ? (...args: Parameters<NonNullable<SshWorkspaceTransferManager["batchDownload"]>>) => (
          runSftpOperation(() => transferManager.batchDownload!(...args))
        )
      : internalFileTransfer.batchDownload,
    cancelTask: transferManager?.cancelTask ?? internalFileTransfer.cancelTask,
    removeTask: transferManager?.removeTask ?? internalFileTransfer.removeTask,
    clearCompleted: transferManager?.clearCompleted ?? internalFileTransfer.clearCompleted,
  }), [internalFileTransfer, runSftpOperation, transferManager]);

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

  const directorySource = useMemo(() => createSftpDirectorySource(directoryCache, (path, signal) => (
    runSftpOperation(() => {
      signal.throwIfAborted();
      return loadSftpDirectory({ serverId, path, convertFileInfo, withParentEntry: false, api: sessionApi, signal });
    })
  )), [directoryCache, runSftpOperation, serverId, convertFileInfo, sessionApi]);

  const runSftpMutation = useCallback(async <T,>(operation: () => Promise<T>, paths: string[], removedSubtrees: string[] = []) => {
    try {
      return await runSftpOperation(operation);
    } finally {
      // 批量操作可能部分成功；即使失败也不能继续展示旧缓存。
      directorySource.invalidate(paths.map(sftpParentPath), removedSubtrees);
    }
  }, [directorySource, runSftpOperation]);

  const operationApi = useMemo<SftpSessionApi>(() => ({
    ...sessionApi,
    delete: (targetServerId, path) => runSftpMutation(() => sessionApi.delete(targetServerId, path), [path], [path]),
    deletePaths: (targetServerId, paths) => runSftpMutation(() => sessionApi.deletePaths(targetServerId, paths), paths, paths),
    createDirectory: (targetServerId, path) => (
      runSftpMutation(() => sessionApi.createDirectory(targetServerId, path), [path])
    ),
    writeFile: (targetServerId, path, content) => (
      runSftpMutation(() => sessionApi.writeFile(targetServerId, path, content), [path])
    ),
    rename: (targetServerId, oldPath, newPath) => (
      runSftpMutation(() => sessionApi.rename(targetServerId, oldPath, newPath), [oldPath, newPath], [oldPath])
    ),
    batchDelete: (targetServerId, paths) => (
      runSftpMutation(() => sessionApi.batchDelete(targetServerId, paths), paths, paths)
    ),
    readFile: (targetServerId, path) => runSftpOperation(() => sessionApi.readFile(targetServerId, path)),
    chmod: sessionApi.chmod
      ? (targetServerId, path, mode) => (
          runSftpMutation(() => sessionApi.chmod!(targetServerId, path, mode), [path])
        )
      : undefined,
  }), [runSftpMutation, runSftpOperation, sessionApi]);

  /**
   * 加载目录内容
   */
  const loadDirectory = useCallback(async (
    inputPath: string,
    { force = false, overlay = false }: { force?: boolean; overlay?: boolean } = {},
  ): Promise<string | null> => {
    if (!serverId) return null;
    const path = resolveSftpNavigationPath(inputPath, currentPathRef.current);
    const active = activeDirectoryRequest.current;
    if (active?.path === path && !force) return active.promise;

    const requestVersion = ++directoryRequestVersion.current;
    // 同路径刷新先取得新租约，避免误取消树或刷新仍需的请求。
    const lease = directorySource.acquire(path, force);
    active?.lease.release();
    setLoadingPresentation(overlay ? "overlay" : "path");
    setPendingPath(path);
    setError(null);
    setFailedPath(null);

    const commit = (directory: LoadedSftpDirectory<FileItem>) => {
      setFiles(directory.files);
      setCurrentPath(directory.path);
      currentPathRef.current = directory.path;
    };
    const cached = !force && !directoryCache.getQueryState([path])?.isInvalidated
      ? directoryCache.getQueryData<LoadedSftpDirectory<FileItem>>([path])
      : undefined;
    if (cached) commit(cached);

    const promise = lease.promise.then((directory) => {
      if (requestVersion !== directoryRequestVersion.current) return null;
      setIsConnected(true);
      commit(directory);
      return directory.path;
    }).catch((err: unknown) => {
      if (requestVersion !== directoryRequestVersion.current || isCancelledError(err)) return null;
      // 仅连接/认证错误改变连接状态；目录权限或路径错误保留原列表。
      const detail = isApiError(err) ? err.detail : err;
      const code = detail && typeof detail === "object"
        ? ("error" in detail ? detail.error : "code" in detail ? detail.code : null)
        : null;
      if (err instanceof TypeError || code === "sftp_error" || code === "sftp_connection_error" || code === "sftp_credential_required") {
        setIsConnected(false);
      }
      setError(getErrorMessage(err, tSftp("directoryLoadFailed")));
      setFailedPath(path);
      return null;
    }).finally(() => {
      lease.release();
      if (requestVersion === directoryRequestVersion.current) {
        activeDirectoryRequest.current = null;
        setLoadingPresentation(null);
        setPendingPath(null);
      }
    });
    activeDirectoryRequest.current = { path, promise, lease };
    return cached ? cached.path : promise;
  }, [serverId, directorySource, directoryCache, tSftp]);

  useEffect(() => directoryCache.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "success") return;
    const directory = event.query.state.data as LoadedSftpDirectory<FileItem> | undefined;
    if (loadedCacheRef.current === directoryCache && directory?.path === currentPathRef.current) {
      setFiles(directory.files);
    }
  }), [directoryCache]);

  // 操作完成后只修改操作发起时的目录；用户已经跳转时不能改写新目录。
  const updateDirectoryFiles = useCallback((updater: FileItem[] | ((items: FileItem[]) => FileItem[])) => {
    if (loadedCacheRef.current !== directoryCache) return;
    const cached = directoryCache.getQueryData<LoadedSftpDirectory<FileItem>>([currentPath]);
    if (cached) {
      const nextFiles = typeof updater === "function" ? updater(cached.files) : updater;
      directoryCache.setQueryData([currentPath], { ...cached, files: nextFiles });
    }
    else if (loadedServerRef.current === serverId && currentPathRef.current === currentPath) setFiles(updater);
  }, [currentPath, directoryCache, serverId]);

  /**
   * 导航到指定路径
   */
  const navigate = useCallback(
    async (path: string) => {
      const intent = ++navigationVersion.current;
      const previousPath = currentPathRef.current;
      const loadedPath = await loadDirectory(path);

      if (intent === navigationVersion.current && loadedPath && loadedPath !== previousPath) {
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

    const intent = ++navigationVersion.current;
    const current = currentPathRef.current;
    const loadedPath = await loadDirectory(previousPath);
    if (!loadedPath || intent !== navigationVersion.current) return;

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

    const intent = ++navigationVersion.current;
    const current = currentPathRef.current;
    const loadedPath = await loadDirectory(nextPath);
    if (!loadedPath || intent !== navigationVersion.current) return;

    setPathForwardStack((prev) => prev.slice(0, -1));
    if (loadedPath !== current) {
      setPathBackStack((prev) => [...prev, current].slice(-50));
    }
  }, [loadDirectory, pathForwardStack]);

  /**
   * 刷新当前目录
   */
  const refresh = useCallback(() => {
    void loadDirectory(currentPathRef.current, { force: true, overlay: true });
  }, [loadDirectory]);

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
        );
        uploadPromises.push(promise);
      }

      try {
        const results = await Promise.allSettled(uploadPromises);
        directorySource.invalidate([currentPath]);
        if (loadedCacheRef.current === directoryCache && currentPathRef.current === currentPath && (!activeDirectoryRequest.current || activeDirectoryRequest.current.path === currentPath)) {
          void loadDirectory(currentPathRef.current, { force: true });
        }
        const failure = results.find((result) => result.status === "rejected");
        if (failure?.status === "rejected") throw failure.reason;
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
    [serverId, currentPath, fileTransfer, loadDirectory, sessionNotifier, tSftp, directoryCache, directorySource]
  );

  /**
   * 下载文件
   */
  const downloadFile = useCallback(
    async (fileName: string) => {
      const file = files.find((f) => f.name === fileName);
      if (!fileName.startsWith('/') && (!file || file.type === 'directory')) return;

      const fullPath = resolveSftpNavigationPath(fileName, currentPath);

      try {
        await fileTransfer.downloadFile(serverId, fullPath, sftpRemoteBaseName(fullPath, fileName));
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
      setFiles: updateDirectoryFiles,
      api: operationApi,
    }),
    [serverId, currentPath, operationApi, sessionNotifier, tSftp, updateDirectoryFiles]
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
      setFiles: updateDirectoryFiles,
      convertFileInfo,
      api: operationApi,
    }),
    [serverId, currentPath, convertFileInfo, operationApi, sessionNotifier, tSftp, updateDirectoryFiles]
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
      setFiles: updateDirectoryFiles,
      convertFileInfo,
      api: operationApi,
    }),
    [serverId, currentPath, convertFileInfo, operationApi, sessionNotifier, tSftp, updateDirectoryFiles]
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
      setFiles: updateDirectoryFiles,
      api: operationApi,
    }),
    [serverId, currentPath, operationApi, sessionNotifier, tSftp, updateDirectoryFiles]
  );

  /**
   * 读取文件内容
   */
  const readFile = useCallback(
    async (fileName: string): Promise<string> => {
      try {
        const fullPath = resolveSftpNavigationPath(fileName, currentPath);

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
    (fileName: string, content: string) => {
      const path = resolveSftpNavigationPath(fileName, currentPath);
      const parent = sftpParentPath(path);
      return performSaveFile({
        serverId, currentPath: parent, fileName: sftpRemoteBaseName(path, fileName), content,
        t: tSftp, notifier: sessionNotifier, convertFileInfo, api: operationApi,
        setFiles: parent === currentPath ? updateDirectoryFiles : (updater) => {
          if (loadedCacheRef.current !== directoryCache) return;
          const cached = directoryCache.getQueryData<LoadedSftpDirectory<FileItem>>([parent]);
          if (cached) directoryCache.setQueryData([parent], {
            ...cached, files: typeof updater === "function" ? updater(cached.files) : updater,
          });
        },
      });
    },
    [serverId, currentPath, convertFileInfo, operationApi, sessionNotifier, tSftp, updateDirectoryFiles, directoryCache]
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
      setFiles: updateDirectoryFiles,
      api: operationApi,
    }),
    [serverId, currentPath, operationApi, sessionNotifier, tSftp, updateDirectoryFiles]
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

        await fileTransfer.batchDownload(serverId, fullPaths, excludePatterns);
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
    loadedCacheRef.current = directoryCache;
    setIsConnected(false);
    setFiles([]);
    currentPathRef.current = initialPath;
    setCurrentPath(initialPath);
    setPathBackStack(initialPathBackStack);
    setPathForwardStack(initialPathForwardStack);
    void loadDirectory(initialPath, { overlay: true });
  }, [serverId, initialPath, initialPathBackStack, initialPathForwardStack, loadDirectory, directoryCache]);

  const notifyHistoryChange = useEffectEvent((history: { currentPath: string; pathBackStack: string[]; pathForwardStack: string[] }) => onHistoryChange?.(history));
  useEffect(() => {
    notifyHistoryChange({
      currentPath,
      pathBackStack,
      pathForwardStack,
    });
  }, [currentPath, pathBackStack, pathForwardStack]);

  // 视图不拥有服务器级连接。请求引用由后端连接池释放，空闲连接由池回收。
  // 仅使卸载/切换服务器前的响应失效，避免写回过期视图。
  useEffect(() => {
    return () => {
      directoryRequestVersion.current += 1;
      navigationVersion.current += 1;
      loadedServerRef.current = null;
      loadedCacheRef.current = null;
      activeDirectoryRequest.current = null;
      directoryCache.clear();
    };
  }, [directoryCache]);

  return {
    // 状态
    directorySource,
    isConnected,
    currentPath,
    files,
    isLoading,
    showLoadingOverlay: loadingPresentation === "overlay",
    pendingPath,
    failedPath,
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
