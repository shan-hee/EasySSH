import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefCallback } from "react"
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine"
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter"
import { dropTargetForExternal } from "@atlaskit/pragmatic-drag-and-drop/external/adapter"
import { containsFiles, getFiles } from "@atlaskit/pragmatic-drag-and-drop/external/file"
import { isSftpFileDragData, SFTP_FILE_DRAG_TYPE } from "@/lib/session/cross-session-file-drag"
import { joinSftpRelativePath, joinSftpRemotePath } from "@/lib/sftp-file-utils"

export interface SftpDragDropFileItem { name: string; type: "file" | "directory" }
export type RegisterSftpDragItem = (element: HTMLElement, fileName: string) => () => void
export interface UseSftpDragDropControllerOptions {
  sessionId: string
  currentPath: string
  files: SftpDragDropFileItem[]
  onRename: (oldName: string, newName: string) => void
  onUpload: (files: FileList) => void | Promise<void>
}

export function useSftpDragDropController({ sessionId, currentPath, files, onRename, onUpload }: UseSftpDragDropControllerOptions) {
  const [isDragging, setIsDragging] = useState(false)
  const [draggedFileName, setDraggedFileName] = useState<string | null>(null)
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null)
  const fileTypes = useMemo(() => new Map(files.map(file => [file.name, file.type])), [files])
  const latest = useRef({ sessionId, currentPath, fileTypes, onRename, onUpload })
  useLayoutEffect(() => { latest.current = { sessionId, currentPath, fileTypes, onRename, onUpload } }, [sessionId, currentPath, fileTypes, onRename, onUpload])

  // Rows register in their own effect. Read current directory metadata when a gesture occurs.
  const registerDragItem = useCallback<RegisterSftpDragItem>((element, name) => combine(
    draggable({
      element,
      canDrag: () => !element.closest('[inert], [aria-hidden="true"]'),
      getInitialData: () => {
        const { sessionId, currentPath, fileTypes } = latest.current
        return {
          type: SFTP_FILE_DRAG_TYPE, sessionId, sourceSessionId: sessionId,
          fileName: name, filePath: joinSftpRemotePath(currentPath, name),
          fileType: fileTypes.get(name) ?? "file",
        }
      },
      onDragStart: () => setDraggedFileName(name),
      onDrop: () => { setDraggedFileName(null); setDragOverFolder(null) },
    }),
    dropTargetForElements({
      element,
      canDrop: ({ source }) => {
        const { sessionId, currentPath, fileTypes } = latest.current
        return !element.closest('[inert], [aria-hidden="true"]') &&
          isSftpFileDragData(source.data) && source.data.sourceSessionId === sessionId &&
          source.data.fileName !== name && source.data.filePath === joinSftpRemotePath(currentPath, source.data.fileName) &&
          fileTypes.get(name) === "directory"
      },
      getDropEffect: () => "move",
      onDragEnter: () => setDragOverFolder(name),
      onDragLeave: () => setDragOverFolder(current => current === name ? null : current),
      onDrop: ({ source, location, self }) => {
        setDragOverFolder(null)
        if (location.current.dropTargets[0]?.element === self.element && isSftpFileDragData(source.data)) {
          latest.current.onRename(source.data.fileName, joinSftpRelativePath(name, source.data.fileName))
        }
      },
    }),
  ), [])

  // A callback ref tracks browser replacement when opening and closing the editor.
  const dropZoneRef = useCallback<RefCallback<HTMLDivElement>>((element) => {
    if (!element) return
    const cleanup = dropTargetForExternal({
      element,
      canDrop: ({ source }) => containsFiles({ source }) && !element.closest('[inert], [aria-hidden="true"]'),
      getDropEffect: () => "copy",
      onDragEnter: () => setIsDragging(true),
      onDragLeave: () => setIsDragging(false),
      onDrop: ({ source, location, self }) => {
        setIsDragging(false)
        if (location.current.dropTargets[0]?.element !== self.element) return
        const files = getFiles({ source })
        if (files.length) {
          const transfer = new DataTransfer()
          files.forEach(file => transfer.items.add(file))
          void latest.current.onUpload(transfer.files)
        }
      },
    })
    return () => { cleanup(); setIsDragging(false) }
  }, [])
  const handleFileUpload = useCallback(async (files: FileList) => { await onUpload(files) }, [onUpload])
  return { dropZoneRef, isDragging, draggedFileName, dragOverFolder, registerDragItem, handleFileUpload }
}
