package sftp

import "github.com/easyssh/shared/protocol"

type FileInfo = protocol.FileInfo
type DirectoryListing = protocol.DirectoryListing

// UploadProgress 上传进度
type UploadProgress struct {
	Filename    string  `json:"filename"`
	Size        int64   `json:"size"`
	Transferred int64   `json:"transferred"`
	Progress    float64 `json:"progress"`
}

// DownloadProgress 下载进度
type DownloadProgress struct {
	Filename    string  `json:"filename"`
	Size        int64   `json:"size"`
	Transferred int64   `json:"transferred"`
	Progress    float64 `json:"progress"`
}

// FileOperationResult 文件操作结果
type FileOperationResult struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Path    string `json:"path,omitempty"`
}

type DiskUsage = protocol.DiskUsage
