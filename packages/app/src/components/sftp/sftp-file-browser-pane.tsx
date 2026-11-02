import type { RegisterSftpDragItem } from "./use-sftp-drag-drop-controller"

import { useLayoutEffect, useMemo, useState, useRef, type ChangeEvent, type FocusEvent, type MouseEvent, type Ref, type RefObject } from "react"
import { Table, TableBody } from "@/components/ui/table"
import { useFileListVirtualizer } from "@/hooks/use-file-list-virtualizer"
import { cn } from "@/lib/utils"
import { SftpCreateEntry } from "@/components/sftp/sftp-create-entry"
import { SftpFileBrowserState } from "@/components/sftp/sftp-file-browser-state"
import { SftpBlankContextMenu } from "@/components/sftp/sftp-context-menu"
import { SftpFileGridItem } from "@/components/sftp/sftp-file-grid-item"
import { SftpFileTableHeader } from "@/components/sftp/sftp-file-table-header"
import { SftpFileTableRow } from "@/components/sftp/sftp-file-table-row"
import type { FileAction } from "@/components/sftp/file-action-menu"
import type {
  EnhancedSftpFileBrowserItem,
  SftpFileSortKey,
  SftpFileSortOrder,
  SftpFileViewMode,
} from "@/components/sftp/use-sftp-file-browser-controller"
import type { SftpCreateEntryType } from "@/components/sftp/use-sftp-file-action-controller"

export interface SftpFileBrowserPaneProps {
  currentPath: string
  hasError?: boolean
  registerDragItem: RegisterSftpDragItem
  viewMode: SftpFileViewMode
  filteredFiles: EnhancedSftpFileBrowserItem[]
  selectedFiles: string[]
  sortBy: SftpFileSortKey
  sortOrder: SftpFileSortOrder
  isDragging: boolean
  isLoading: boolean
  showLoadingOverlay: boolean
  searchTerm: string
  creatingNew: SftpCreateEntryType | null
  editingFile: string | null
  editingFileName: string
  draggedFileName: string | null
  dragOverFolder: string | null
  dropZoneRef: Ref<HTMLDivElement>
  fileInputRef: RefObject<HTMLInputElement | null>
  editInputRef: RefObject<HTMLInputElement | null>
  folderLabel: string
  onClearSelectedFiles: () => void
  onOpenBlankContextMenu: () => void
  onCloseContextMenu: () => void
  onCreateFolder: () => void
  onCreateFile: () => void
  onUpload: () => void
  onRefresh: () => void
  onEditingFileNameChange: (value: string) => void
  onFinishCreate: () => void | Promise<void>
  onCancelCreate: () => void
  onCreateBlur: (event: FocusEvent<HTMLInputElement>) => void
  onFinishRename: () => void
  onCancelRename: () => void
  onRenameBlur: (event: FocusEvent<HTMLInputElement>) => void
  onFileSelect: (fileName: string, event: MouseEvent<HTMLElement>) => void
  onFileDoubleClick: (fileName: string, fileType: "file" | "directory") => void
  onOpenFileContextMenu: (fileName: string, fileType: "file" | "directory") => void
  onSort: (key: SftpFileSortKey) => void
  onAction: (file: EnhancedSftpFileBrowserItem, action: FileAction) => void
  onContextAction: (action: FileAction) => void
  onInputChange: (event: ChangeEvent<HTMLInputElement>) => void
}

export function SftpFileBrowserPane({
  currentPath,
  hasError = false,
  registerDragItem,
  viewMode,
  filteredFiles,
  selectedFiles,
  sortBy,
  sortOrder,
  isDragging,
  isLoading,
  showLoadingOverlay,
  searchTerm,
  creatingNew,
  editingFile,
  editingFileName,
  draggedFileName,
  dragOverFolder,
  dropZoneRef,
  fileInputRef,
  editInputRef,
  folderLabel,
  onClearSelectedFiles,
  onOpenBlankContextMenu,
  onCloseContextMenu,
  onCreateFolder,
  onCreateFile,
  onUpload,
  onRefresh,
  onEditingFileNameChange,
  onFinishCreate,
  onCancelCreate,
  onCreateBlur,
  onFinishRename,
  onCancelRename,
  onRenameBlur,
  onFileSelect,
  onFileDoubleClick,
  onOpenFileContextMenu,
  onSort,
  onAction,
  onContextAction,
  onInputChange,
}: SftpFileBrowserPaneProps) {
  const listScrollRef = useRef<HTMLDivElement>(null)
  const gridScrollRef = useRef<HTMLDivElement>(null)
  const shouldVirtualize = filteredFiles.length > 100
  const [gridColumns, setGridColumns] = useState(1)
  const gridCreateRef = useRef<HTMLDivElement>(null)
  const [gridCreateHeight, setGridCreateHeight] = useState(0)
  const selectedNames = useMemo(() => new Set(selectedFiles), [selectedFiles])
  const scrollPositions = useRef(new Map<string, number>())

  useLayoutEffect(() => {
    const element = gridScrollRef.current
    if (!element) return
    const resize = () => setGridColumns(Math.max(1, Math.min(6, Math.floor((element.clientWidth - 12) / 120))))
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [viewMode])

  const rememberScroll = (element: HTMLDivElement) => {
    const positions = scrollPositions.current
    const key = `${viewMode}:${currentPath}`
    positions.delete(key)
    positions.set(key, element.scrollTop)
    if (positions.size > 100) {
      const oldest = positions.keys().next().value
      if (oldest !== undefined) positions.delete(oldest)
    }
  }

  useLayoutEffect(() => {
    const element = viewMode === "grid" ? gridScrollRef.current : listScrollRef.current
    if (element) element.scrollTop = scrollPositions.current.get(`${viewMode}:${currentPath}`) ?? 0
  }, [currentPath, viewMode])

  useLayoutEffect(() => {
    const element = gridCreateRef.current
    if (!element) { setGridCreateHeight(0); return }
    const measure = () => setGridCreateHeight(element.getBoundingClientRect().height)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [creatingNew, viewMode])

  const listVirtualizer = useFileListVirtualizer({
    scrollElementRef: listScrollRef,
    count: filteredFiles.length,
    viewMode: "list",
    enabled: shouldVirtualize && viewMode === "list",
  })
  const gridVirtualizer = useFileListVirtualizer({
    scrollElementRef: gridScrollRef,
    count: filteredFiles.length,
    viewMode: "grid",
    gridColumns,
    paddingStart: creatingNew ? gridCreateHeight : 0,
    enabled: shouldVirtualize && viewMode === "grid",
  })

  useLayoutEffect(() => {
    gridVirtualizer.virtualizer.measure()
  }, [gridColumns, gridVirtualizer.virtualizer])

  const renderGridItem = (file: EnhancedSftpFileBrowserItem) => (
    <SftpFileGridItem
      registerDragItem={registerDragItem}
      key={file.name}
      file={file}
      isSelected={selectedNames.has(file.name)}
      isEditing={editingFile === file.name}
      isDraggedOver={dragOverFolder === file.name}
      isDragged={draggedFileName === file.name}
      editingFileName={editingFileName}
      editInputRef={editInputRef}
      folderLabel={folderLabel}
      onEditingFileNameChange={onEditingFileNameChange}
      onFinishRename={onFinishRename}
      onCancelRename={onCancelRename}
      onRenameBlur={onRenameBlur}
      onSelect={onFileSelect}
      onDoubleClick={onFileDoubleClick}
      onOpenContextMenu={onOpenFileContextMenu}
      onCloseContextMenu={onCloseContextMenu}
      selectedFilesCount={selectedFiles.length}
      onContextAction={onContextAction}
    />
  )

  const renderTableRow = (file: EnhancedSftpFileBrowserItem, dataIndex?: number) => (
    <SftpFileTableRow
      registerDragItem={registerDragItem}
      key={file.name}
      file={file}
      dataIndex={dataIndex}
      measureElement={dataIndex !== undefined ? listVirtualizer.virtualizer.measureElement : undefined}
      isSelected={selectedNames.has(file.name)}
      isEditing={editingFile === file.name}
      isDraggedOver={dragOverFolder === file.name}
      isDragged={draggedFileName === file.name}
      editingFileName={editingFileName}
      editInputRef={editInputRef}
      selectedFilesCount={selectedFiles.length}
      onEditingFileNameChange={onEditingFileNameChange}
      onFinishRename={onFinishRename}
      onCancelRename={onCancelRename}
      onRenameBlur={onRenameBlur}
      onSelect={onFileSelect}
      onDoubleClick={onFileDoubleClick}
      onOpenContextMenu={onOpenFileContextMenu}
      onCloseContextMenu={onCloseContextMenu}
      onAction={(_, action) => onAction(file, action)}
      onContextAction={onContextAction}
    />
  )

  const browserPane = (
    <div
      ref={dropZoneRef}
      data-sftp-browser="files"
      aria-busy={isLoading}
      data-file-drop-target
      className={cn(
        "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
        viewMode === "grid" ? "overflow-hidden" : "",
        isDragging && "bg-primary/10",
      )}
      onMouseDown={(event) => {
        if (event.button === 0) {
          onClearSelectedFiles()
        }
      }}
    >
      <SftpFileBrowserState
        isDragging={isDragging}
        isLoading={isLoading}
        showLoadingOverlay={showLoadingOverlay}
        isEmpty={!hasError && filteredFiles.length === 0 && !creatingNew}
        searchTerm={searchTerm}
      />

      {viewMode === "grid" ? (
          <div ref={gridScrollRef} onScroll={(event) => rememberScroll(event.currentTarget)} className="overflow-auto h-full scrollbar-custom">
            <div
              className="p-3"
              style={{
                height: shouldVirtualize ? `${gridVirtualizer.virtualizer.getTotalSize() + 24}px` : "auto",
                position: "relative",
              }}
            >
              {creatingNew && (
                <SftpCreateEntry
                  variant="grid"
                  containerRef={gridCreateRef}
                  gridColumns={gridColumns}
                  type={creatingNew}
                  name={editingFileName}
                  inputRef={editInputRef}
                  onNameChange={onEditingFileNameChange}
                  onConfirm={() => { void onFinishCreate() }}
                  onCancel={onCancelCreate}
                  onBlur={onCreateBlur}
                />
              )}

              {shouldVirtualize ? (
                gridVirtualizer.virtualizer.getVirtualItems().map((virtualRow) => {
                  const { start, end } = gridVirtualizer.getFileIndicesForRow(virtualRow.index)
                  const rowFiles = filteredFiles.slice(start, end)

                  return (
                    <div
                      key={virtualRow.index}
                      data-index={virtualRow.index}
                      ref={gridVirtualizer.virtualizer.measureElement}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 12,
                        width: "calc(100% - 24px)",
                        paddingBottom: 12,
                        transform: `translateY(${virtualRow.start + 12}px)`,
                      }}
                    >
                      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))` }}>
                        {rowFiles.map(renderGridItem)}
                      </div>
                    </div>
                  )
                })
              ) : (
                <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))` }}>
                  {filteredFiles.map(renderGridItem)}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div ref={listScrollRef} onScroll={(event) => rememberScroll(event.currentTarget)} className="overflow-auto h-full scrollbar-custom">
            <Table className="sftp-table text-xs [&_th]:h-9 [&_th]:px-3 [&_th]:text-xs [&_td]:px-3 [&_td]:py-1.5 [&_td]:align-middle">
              <SftpFileTableHeader
                sortBy={sortBy}
                sortOrder={sortOrder}
                onSort={onSort}
              />
              <TableBody>
                {creatingNew && (
                  <SftpCreateEntry
                    variant="list"
                    type={creatingNew}
                    name={editingFileName}
                    inputRef={editInputRef}
                    onNameChange={onEditingFileNameChange}
                    onConfirm={() => { void onFinishCreate() }}
                    onCancel={onCancelCreate}
                    onBlur={onCreateBlur}
                  />
                )}

                {shouldVirtualize && listVirtualizer.virtualizer.getVirtualItems().length > 0 && (
                  <tr style={{ height: `${listVirtualizer.virtualizer.getVirtualItems()[0]?.start ?? 0}px` }} />
                )}

                {shouldVirtualize ? (
                  <>
                    {listVirtualizer.virtualizer.getVirtualItems().map((virtualRow) => {
                      const file = filteredFiles[virtualRow.index]
                      if (!file) return null
                      return renderTableRow(file, virtualRow.index)
                    })}
                    {listVirtualizer.virtualizer.getVirtualItems().length > 0 && (
                      <tr
                        style={{
                          height: `${
                            listVirtualizer.virtualizer.getTotalSize() -
                            (listVirtualizer.virtualizer.getVirtualItems()[listVirtualizer.virtualizer.getVirtualItems().length - 1]?.end ?? 0)
                          }px`,
                        }}
                      />
                    )}
                  </>
                ) : (
                  filteredFiles.map((file) => renderTableRow(file))
                )}
              </TableBody>
            </Table>
          </div>
        )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        tabIndex={-1}
        onChange={onInputChange}
      />
    </div>
  )

  return (
    <SftpBlankContextMenu
      selectedFilesCount={selectedFiles.length}
      disabled={editingFile !== null}
      onOpenChange={(open) => {
        if (open) {
          onOpenBlankContextMenu()
        } else {
          onCloseContextMenu()
        }
      }}
      onCreateFolder={onCreateFolder}
      onCreateFile={onCreateFile}
      onUpload={onUpload}
      onRefresh={onRefresh}
    >
      {browserPane}
    </SftpBlankContextMenu>
  )
}
