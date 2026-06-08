package main

import (
	"archive/zip"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
)

const desktopSFTPMaxTextBytes = 5 << 20

type DesktopSFTPPathInput struct {
	ServerID string `json:"serverId"`
	Path     string `json:"path"`
}

type DesktopSFTPRenameInput struct {
	ServerID string `json:"serverId"`
	OldPath  string `json:"oldPath"`
	NewPath  string `json:"newPath"`
}

type DesktopSFTPWriteFileInput struct {
	ServerID string `json:"serverId"`
	Path     string `json:"path"`
	Content  string `json:"content"`
}

type DesktopSFTPChmodInput struct {
	ServerID string `json:"serverId"`
	Path     string `json:"path"`
	Mode     string `json:"mode"`
}

type DesktopSFTPUploadFileInput struct {
	ServerID string `json:"serverId"`
	Path     string `json:"path"`
	FileName string `json:"fileName"`
	Data     string `json:"data"`
}

type DesktopSFTPDownloadFileInput struct {
	ServerID  string `json:"serverId"`
	Path      string `json:"path"`
	LocalPath string `json:"localPath"`
}

type DesktopSFTPBatchDeleteInput struct {
	ServerID string   `json:"serverId"`
	Paths    []string `json:"paths"`
}

type DesktopSFTPBatchDownloadInput struct {
	ServerID  string   `json:"serverId"`
	Paths     []string `json:"paths"`
	LocalPath string   `json:"localPath"`
}

type DesktopSFTPDirectTransferInput struct {
	SourceServerID   string                `json:"sourceServerId"`
	SourcePath       string                `json:"sourcePath"`
	TargetServerID   string                `json:"targetServerId"`
	TargetPath       string                `json:"targetPath"`
	SourceCredential *DesktopSSHCredential `json:"sourceCredential,omitempty"`
	TargetCredential *DesktopSSHCredential `json:"targetCredential,omitempty"`
}

type DesktopSFTPAuthenticateInput struct {
	ServerID             string                  `json:"serverId"`
	AuthMethod           DesktopServerAuthMethod `json:"authMethod"`
	Secret               string                  `json:"secret"`
	PrivateKeyPassphrase string                  `json:"privateKeyPassphrase,omitempty"`
}

type DesktopSFTPFileInfo struct {
	Name       string `json:"name"`
	Path       string `json:"path"`
	Size       int64  `json:"size"`
	Mode       uint32 `json:"mode"`
	ModTime    string `json:"mod_time"`
	IsDir      bool   `json:"is_dir"`
	IsLink     bool   `json:"is_link"`
	LinkTarget string `json:"link_target,omitempty"`
	Permission string `json:"permission,omitempty"`
}

type DesktopSFTPDirectoryListResult struct {
	Path   string                `json:"path"`
	Files  []DesktopSFTPFileInfo `json:"files"`
	Parent string                `json:"parent,omitempty"`
}

type DesktopSFTPBatchOperationError struct {
	Path    string `json:"path"`
	Error   string `json:"error"`
	Message string `json:"message"`
}

type DesktopSFTPBatchDeleteResult struct {
	Success []string                         `json:"success"`
	Failed  []DesktopSFTPBatchOperationError `json:"failed"`
	Total   int                              `json:"total"`
}

type DesktopSFTPUploadTaskListResult struct {
	Tasks []DesktopSFTPUploadTaskStatus `json:"tasks"`
}

type DesktopSFTPUploadTaskStatus struct {
	ID        string `json:"id"`
	FileName  string `json:"file_name"`
	FileSize  int64  `json:"file_size"`
	Status    string `json:"status"`
	Progress  int    `json:"progress"`
	Loaded    int64  `json:"loaded"`
	Total     int64  `json:"total"`
	SpeedBps  int64  `json:"speed_bps"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

type DesktopSFTPDirectTransferResult struct {
	Success bool   `json:"success"`
	TaskID  string `json:"task_id"`
	Message string `json:"message"`
}

type DesktopSFTPService struct {
	serverService *DesktopServerService
}

func NewDesktopSFTPService(serverService *DesktopServerService) *DesktopSFTPService {
	return &DesktopSFTPService{
		serverService: serverService,
	}
}

func (s *DesktopSFTPService) Authenticate(input DesktopSFTPAuthenticateInput) error {
	serverID := strings.TrimSpace(input.ServerID)
	if serverID == "" {
		return errors.New("server id is required")
	}
	if input.AuthMethod != DesktopServerAuthPassword && input.AuthMethod != DesktopServerAuthKey {
		return fmt.Errorf("unsupported auth method: %s", input.AuthMethod)
	}
	if input.AuthMethod == DesktopServerAuthPassword && input.Secret == "" {
		return errors.New("server credential is required")
	}

	credential := DesktopSSHCredential{
		AuthMethod:           input.AuthMethod,
		Secret:               input.Secret,
		PrivateKeyPassphrase: input.PrivateKeyPassphrase,
	}
	_, closer, err := s.openClientWithCredential(serverID, &credential)
	if err != nil {
		return err
	}
	closer()

	s.serverService.setTemporaryCredential(serverID, credential)
	return nil
}

func (s *DesktopSFTPService) ListDirectory(input DesktopSFTPPathInput) (DesktopSFTPDirectoryListResult, error) {
	remotePath := normalizeDesktopSFTPPath(input.Path)
	client, closer, err := s.openClient(input.ServerID)
	if err != nil {
		return DesktopSFTPDirectoryListResult{}, err
	}
	defer closer()

	entries, err := client.ReadDir(remotePath)
	if err != nil {
		return DesktopSFTPDirectoryListResult{}, err
	}

	files := make([]DesktopSFTPFileInfo, 0, len(entries))
	for _, entry := range entries {
		name := entry.Name()
		if name == "." || name == ".." {
			continue
		}

		fullPath := joinDesktopSFTPPath(remotePath, name)
		linkTarget := ""
		if entry.Mode()&os.ModeSymlink != 0 {
			if target, readErr := client.ReadLink(fullPath); readErr == nil {
				linkTarget = target
			}
		}
		files = append(files, desktopSFTPFileInfoFromFileInfo(fullPath, entry, linkTarget))
	}

	return DesktopSFTPDirectoryListResult{
		Path:   remotePath,
		Parent: desktopSFTPParent(remotePath),
		Files:  files,
	}, nil
}

func (s *DesktopSFTPService) Delete(input DesktopSFTPPathInput) (DesktopSFTPFileInfo, error) {
	remotePath := normalizeDesktopSFTPPath(input.Path)
	client, closer, err := s.openClient(input.ServerID)
	if err != nil {
		return DesktopSFTPFileInfo{}, err
	}
	defer closer()

	info, err := client.Lstat(remotePath)
	if err != nil {
		return DesktopSFTPFileInfo{}, err
	}
	snapshot := desktopSFTPFileInfoFromFileInfo(remotePath, info, "")

	if info.IsDir() && info.Mode()&os.ModeSymlink == 0 {
		err = removeDesktopSFTPDirectory(client, remotePath)
	} else {
		err = client.Remove(remotePath)
	}
	if err != nil {
		return DesktopSFTPFileInfo{}, err
	}

	return snapshot, nil
}

func (s *DesktopSFTPService) BatchDelete(input DesktopSFTPBatchDeleteInput) (DesktopSFTPBatchDeleteResult, error) {
	client, closer, err := s.openClient(input.ServerID)
	if err != nil {
		return DesktopSFTPBatchDeleteResult{}, err
	}
	defer closer()

	result := DesktopSFTPBatchDeleteResult{
		Success: []string{},
		Failed:  []DesktopSFTPBatchOperationError{},
		Total:   len(input.Paths),
	}

	for _, itemPath := range input.Paths {
		remotePath := normalizeDesktopSFTPPath(itemPath)
		info, statErr := client.Lstat(remotePath)
		if statErr != nil {
			result.Failed = append(result.Failed, desktopSFTPBatchError(remotePath, statErr))
			continue
		}

		if info.IsDir() && info.Mode()&os.ModeSymlink == 0 {
			err = removeDesktopSFTPDirectory(client, remotePath)
		} else {
			err = client.Remove(remotePath)
		}
		if err != nil {
			result.Failed = append(result.Failed, desktopSFTPBatchError(remotePath, err))
			continue
		}

		result.Success = append(result.Success, remotePath)
	}

	return result, nil
}

func (s *DesktopSFTPService) CreateDirectory(input DesktopSFTPPathInput) (DesktopSFTPFileInfo, error) {
	remotePath := normalizeDesktopSFTPPath(input.Path)
	client, closer, err := s.openClient(input.ServerID)
	if err != nil {
		return DesktopSFTPFileInfo{}, err
	}
	defer closer()

	if err := client.Mkdir(remotePath); err != nil {
		return DesktopSFTPFileInfo{}, err
	}

	return desktopSFTPStat(client, remotePath)
}

func (s *DesktopSFTPService) Rename(input DesktopSFTPRenameInput) (DesktopSFTPFileInfo, error) {
	oldPath := normalizeDesktopSFTPPath(input.OldPath)
	newPath := normalizeDesktopSFTPPath(input.NewPath)
	client, closer, err := s.openClient(input.ServerID)
	if err != nil {
		return DesktopSFTPFileInfo{}, err
	}
	defer closer()

	if err := client.Rename(oldPath, newPath); err != nil {
		return DesktopSFTPFileInfo{}, err
	}

	return desktopSFTPStat(client, newPath)
}

func (s *DesktopSFTPService) ReadFile(input DesktopSFTPPathInput) (string, error) {
	remotePath := normalizeDesktopSFTPPath(input.Path)
	client, closer, err := s.openClient(input.ServerID)
	if err != nil {
		return "", err
	}
	defer closer()

	info, err := client.Stat(remotePath)
	if err != nil {
		return "", err
	}
	if info.IsDir() {
		return "", errors.New("cannot read a directory")
	}
	if info.Size() > desktopSFTPMaxTextBytes {
		return "", fmt.Errorf("file is too large to edit: %d bytes", info.Size())
	}

	file, err := client.Open(remotePath)
	if err != nil {
		return "", err
	}
	defer file.Close()

	content, err := io.ReadAll(io.LimitReader(file, desktopSFTPMaxTextBytes+1))
	if err != nil {
		return "", err
	}
	if len(content) > desktopSFTPMaxTextBytes {
		return "", fmt.Errorf("file is too large to edit: %d bytes", len(content))
	}

	return string(content), nil
}

func (s *DesktopSFTPService) WriteFile(input DesktopSFTPWriteFileInput) (DesktopSFTPFileInfo, error) {
	remotePath := normalizeDesktopSFTPPath(input.Path)
	client, closer, err := s.openClient(input.ServerID)
	if err != nil {
		return DesktopSFTPFileInfo{}, err
	}
	defer closer()

	file, err := client.OpenFile(remotePath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC)
	if err != nil {
		return DesktopSFTPFileInfo{}, err
	}
	if _, err := file.Write([]byte(input.Content)); err != nil {
		_ = file.Close()
		return DesktopSFTPFileInfo{}, err
	}
	if err := file.Close(); err != nil {
		return DesktopSFTPFileInfo{}, err
	}

	return desktopSFTPStat(client, remotePath)
}

func (s *DesktopSFTPService) Chmod(input DesktopSFTPChmodInput) error {
	remotePath := normalizeDesktopSFTPPath(input.Path)
	mode, err := strconv.ParseUint(strings.TrimSpace(input.Mode), 8, 32)
	if err != nil {
		return fmt.Errorf("invalid chmod mode: %w", err)
	}

	client, closer, err := s.openClient(input.ServerID)
	if err != nil {
		return err
	}
	defer closer()

	return client.Chmod(remotePath, os.FileMode(mode))
}

func (s *DesktopSFTPService) UploadFile(input DesktopSFTPUploadFileInput) (DesktopSFTPFileInfo, error) {
	basePath := normalizeDesktopSFTPPath(input.Path)
	fileName := path.Base(strings.TrimSpace(input.FileName))
	if fileName == "." || fileName == "/" || fileName == "" {
		return DesktopSFTPFileInfo{}, errors.New("file name is required")
	}

	data, err := base64.StdEncoding.DecodeString(input.Data)
	if err != nil {
		return DesktopSFTPFileInfo{}, err
	}

	remotePath := joinDesktopSFTPPath(basePath, fileName)
	client, closer, err := s.openClient(input.ServerID)
	if err != nil {
		return DesktopSFTPFileInfo{}, err
	}
	defer closer()

	file, err := client.OpenFile(remotePath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC)
	if err != nil {
		return DesktopSFTPFileInfo{}, err
	}
	if _, err := file.Write(data); err != nil {
		_ = file.Close()
		return DesktopSFTPFileInfo{}, err
	}
	if err := file.Close(); err != nil {
		return DesktopSFTPFileInfo{}, err
	}

	return desktopSFTPStat(client, remotePath)
}

func (s *DesktopSFTPService) DownloadFile(input DesktopSFTPDownloadFileInput) error {
	remotePath := normalizeDesktopSFTPPath(input.Path)
	localPath := strings.TrimSpace(input.LocalPath)
	if localPath == "" {
		return errors.New("local path is required")
	}

	client, closer, err := s.openClient(input.ServerID)
	if err != nil {
		return err
	}
	defer closer()

	info, err := client.Stat(remotePath)
	if err != nil {
		return err
	}
	if info.IsDir() {
		return errors.New("cannot download a directory as a single file")
	}

	remoteFile, err := client.Open(remotePath)
	if err != nil {
		return err
	}
	defer remoteFile.Close()

	localFile, err := os.Create(localPath)
	if err != nil {
		return err
	}
	if _, err := io.Copy(localFile, remoteFile); err != nil {
		_ = localFile.Close()
		return err
	}

	return localFile.Close()
}

func (s *DesktopSFTPService) BatchDownload(input DesktopSFTPBatchDownloadInput) error {
	localPath := strings.TrimSpace(input.LocalPath)
	if localPath == "" {
		return errors.New("local path is required")
	}
	if len(input.Paths) == 0 {
		return errors.New("paths are required")
	}

	client, closer, err := s.openClient(input.ServerID)
	if err != nil {
		return err
	}
	defer closer()

	localFile, err := os.Create(localPath)
	if err != nil {
		return err
	}
	defer localFile.Close()

	zipWriter := zip.NewWriter(localFile)
	for _, itemPath := range input.Paths {
		remotePath := normalizeDesktopSFTPPath(itemPath)
		baseName := strings.Trim(path.Base(remotePath), "/")
		if baseName == "" || baseName == "." {
			baseName = "download"
		}

		if err := addDesktopSFTPZipEntry(client, zipWriter, remotePath, baseName); err != nil {
			_ = zipWriter.Close()
			return err
		}
	}

	return zipWriter.Close()
}

func (s *DesktopSFTPService) CreateUploadTask() (map[string]string, error) {
	return map[string]string{"task_id": fmt.Sprintf("desktop-upload-%d", time.Now().UnixNano())}, nil
}

func (s *DesktopSFTPService) ListUploadTasks() (DesktopSFTPUploadTaskListResult, error) {
	return DesktopSFTPUploadTaskListResult{Tasks: []DesktopSFTPUploadTaskStatus{}}, nil
}

func (s *DesktopSFTPService) CancelUploadTask(_ string) error {
	return nil
}

func (s *DesktopSFTPService) DirectTransfer(input DesktopSFTPDirectTransferInput) (DesktopSFTPDirectTransferResult, error) {
	sourceServerID := strings.TrimSpace(input.SourceServerID)
	targetServerID := strings.TrimSpace(input.TargetServerID)
	if sourceServerID == "" {
		return DesktopSFTPDirectTransferResult{}, errors.New("source server id is required")
	}
	if targetServerID == "" {
		return DesktopSFTPDirectTransferResult{}, errors.New("target server id is required")
	}

	sourcePath := normalizeDesktopSFTPPath(input.SourcePath)
	targetPath := normalizeDesktopSFTPPath(input.TargetPath)
	if sourceServerID == targetServerID {
		return DesktopSFTPDirectTransferResult{}, errors.New("cannot transfer between the same server")
	}

	sourceClient, sourceCloser, err := s.openClientForTransfer(sourceServerID, input.SourceCredential)
	if err != nil {
		return DesktopSFTPDirectTransferResult{}, fmt.Errorf("failed to connect source server: %w", err)
	}
	defer sourceCloser()

	targetClient, targetCloser, err := s.openClientForTransfer(targetServerID, input.TargetCredential)
	if err != nil {
		return DesktopSFTPDirectTransferResult{}, fmt.Errorf("failed to connect target server: %w", err)
	}
	defer targetCloser()

	sourceInfo, err := sourceClient.Stat(sourcePath)
	if err != nil {
		return DesktopSFTPDirectTransferResult{}, fmt.Errorf("failed to stat source path: %w", err)
	}

	stats, err := copyDesktopSFTPPath(sourceClient, targetClient, sourcePath, targetPath, sourceInfo)
	if err != nil {
		return DesktopSFTPDirectTransferResult{}, err
	}

	return DesktopSFTPDirectTransferResult{
		Success: true,
		TaskID:  fmt.Sprintf("desktop-transfer-%d", time.Now().UnixNano()),
		Message: fmt.Sprintf("Transfer completed: %d file(s), %d byte(s) copied", stats.FilesCopied, stats.BytesCopied),
	}, nil
}

func (s *DesktopSFTPService) CancelTransfer(_ string) error {
	return nil
}

func (s *DesktopSFTPService) CloseConnection(serverID string) error {
	serverID = strings.TrimSpace(serverID)
	if serverID == "" {
		return nil
	}

	s.serverService.clearTemporaryCredential(serverID)
	return nil
}

func (s *DesktopSFTPService) openClient(serverID string) (*sftp.Client, func(), error) {
	serverID = strings.TrimSpace(serverID)
	if serverID == "" {
		return nil, nil, errors.New("server id is required")
	}

	if credential, hasCredential := s.serverService.getTemporaryCredential(serverID); hasCredential {
		return s.openClientWithCredential(serverID, credential)
	}

	return s.openClientWithCredential(serverID, nil)
}

func (s *DesktopSFTPService) openClientForTransfer(serverID string, credential *DesktopSSHCredential) (*sftp.Client, func(), error) {
	if credential == nil {
		return s.openClient(serverID)
	}

	client, closer, err := s.openClientWithCredential(serverID, credential)
	if err != nil {
		return nil, nil, err
	}

	s.serverService.setTemporaryCredential(serverID, *credential)
	return client, closer, nil
}

func (s *DesktopSFTPService) openClientWithCredential(serverID string, credential *DesktopSSHCredential) (*sftp.Client, func(), error) {
	serverID = strings.TrimSpace(serverID)
	if serverID == "" {
		return nil, nil, errors.New("server id is required")
	}

	server, err := s.serverService.GetById(serverID)
	if err != nil {
		return nil, nil, err
	}

	authMethods, err := buildDesktopServerSSHAuthMethodsWithCredential(server, credential)
	if err != nil {
		return nil, nil, err
	}
	if len(authMethods) == 0 {
		return nil, nil, errors.New("server credential is required")
	}

	config := &ssh.ClientConfig{
		User:            server.Username,
		Auth:            authMethods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         12 * time.Second,
	}

	address := net.JoinHostPort(server.Host, strconv.Itoa(server.Port))
	sshClient, err := ssh.Dial("tcp", address, config)
	if err != nil {
		return nil, nil, err
	}

	sftpClient, err := sftp.NewClient(sshClient)
	if err != nil {
		_ = sshClient.Close()
		return nil, nil, err
	}

	closer := func() {
		_ = sftpClient.Close()
		_ = sshClient.Close()
	}
	return sftpClient, closer, nil
}

func desktopSFTPStat(client *sftp.Client, remotePath string) (DesktopSFTPFileInfo, error) {
	info, err := client.Lstat(remotePath)
	if err != nil {
		return DesktopSFTPFileInfo{}, err
	}

	linkTarget := ""
	if info.Mode()&os.ModeSymlink != 0 {
		if target, readErr := client.ReadLink(remotePath); readErr == nil {
			linkTarget = target
		}
	}

	return desktopSFTPFileInfoFromFileInfo(remotePath, info, linkTarget), nil
}

func desktopSFTPFileInfoFromFileInfo(remotePath string, info os.FileInfo, linkTarget string) DesktopSFTPFileInfo {
	mode := info.Mode()
	return DesktopSFTPFileInfo{
		Name:       info.Name(),
		Path:       normalizeDesktopSFTPPath(remotePath),
		Size:       info.Size(),
		Mode:       uint32(mode.Perm()),
		ModTime:    info.ModTime().UTC().Format(time.RFC3339Nano),
		IsDir:      info.IsDir(),
		IsLink:     mode&os.ModeSymlink != 0,
		LinkTarget: linkTarget,
		Permission: desktopSFTPPermissionString(mode),
	}
}

func removeDesktopSFTPDirectory(client *sftp.Client, remotePath string) error {
	entries, err := client.ReadDir(remotePath)
	if err != nil {
		return err
	}

	for _, entry := range entries {
		name := entry.Name()
		if name == "." || name == ".." {
			continue
		}

		childPath := joinDesktopSFTPPath(remotePath, name)
		if entry.IsDir() && entry.Mode()&os.ModeSymlink == 0 {
			if err := removeDesktopSFTPDirectory(client, childPath); err != nil {
				return err
			}
			continue
		}

		if err := client.Remove(childPath); err != nil {
			return err
		}
	}

	return client.RemoveDirectory(remotePath)
}

func addDesktopSFTPZipEntry(client *sftp.Client, zipWriter *zip.Writer, remotePath string, archivePath string) error {
	info, err := client.Lstat(remotePath)
	if err != nil {
		return err
	}

	archivePath = strings.TrimPrefix(strings.ReplaceAll(archivePath, "\\", "/"), "/")
	if archivePath == "" || archivePath == "." {
		archivePath = info.Name()
	}

	if info.IsDir() && info.Mode()&os.ModeSymlink == 0 {
		dirHeader, err := zip.FileInfoHeader(info)
		if err != nil {
			return err
		}
		dirHeader.Name = strings.TrimRight(archivePath, "/") + "/"
		dirHeader.Method = zip.Deflate
		if _, err := zipWriter.CreateHeader(dirHeader); err != nil {
			return err
		}

		entries, err := client.ReadDir(remotePath)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			name := entry.Name()
			if name == "." || name == ".." {
				continue
			}

			childRemotePath := joinDesktopSFTPPath(remotePath, name)
			childArchivePath := strings.TrimRight(archivePath, "/") + "/" + name
			if err := addDesktopSFTPZipEntry(client, zipWriter, childRemotePath, childArchivePath); err != nil {
				return err
			}
		}
		return nil
	}

	remoteFile, err := client.Open(remotePath)
	if err != nil {
		return err
	}
	defer remoteFile.Close()

	fileHeader, err := zip.FileInfoHeader(info)
	if err != nil {
		return err
	}
	fileHeader.Name = archivePath
	fileHeader.Method = zip.Deflate

	archiveFile, err := zipWriter.CreateHeader(fileHeader)
	if err != nil {
		return err
	}

	_, err = io.Copy(archiveFile, remoteFile)
	return err
}

type desktopSFTPTransferStats struct {
	FilesCopied int
	BytesCopied int64
}

func copyDesktopSFTPPath(sourceClient *sftp.Client, targetClient *sftp.Client, sourcePath string, targetPath string, sourceInfo os.FileInfo) (desktopSFTPTransferStats, error) {
	stats := desktopSFTPTransferStats{}
	if sourceInfo.IsDir() {
		targetDir := joinDesktopSFTPPath(targetPath, sourceInfo.Name())
		if err := copyDesktopSFTPDirectory(sourceClient, targetClient, sourcePath, targetDir, &stats); err != nil {
			return desktopSFTPTransferStats{}, err
		}
		return stats, nil
	}

	targetFilePath := targetPath
	if targetInfo, err := targetClient.Stat(targetPath); err == nil && targetInfo.IsDir() {
		targetFilePath = joinDesktopSFTPPath(targetPath, path.Base(sourcePath))
	}
	if err := copyDesktopSFTPFile(sourceClient, targetClient, sourcePath, targetFilePath, sourceInfo, &stats); err != nil {
		return desktopSFTPTransferStats{}, err
	}

	return stats, nil
}

func copyDesktopSFTPDirectory(sourceClient *sftp.Client, targetClient *sftp.Client, sourceDir string, targetDir string, stats *desktopSFTPTransferStats) error {
	if err := targetClient.MkdirAll(targetDir); err != nil {
		return fmt.Errorf("failed to create target directory: %w", err)
	}

	entries, err := sourceClient.ReadDir(sourceDir)
	if err != nil {
		return fmt.Errorf("failed to read source directory: %w", err)
	}

	for _, entry := range entries {
		name := entry.Name()
		if name == "." || name == ".." {
			continue
		}

		childSourcePath := joinDesktopSFTPPath(sourceDir, name)
		childTargetPath := joinDesktopSFTPPath(targetDir, name)
		if entry.IsDir() && entry.Mode()&os.ModeSymlink == 0 {
			if err := copyDesktopSFTPDirectory(sourceClient, targetClient, childSourcePath, childTargetPath, stats); err != nil {
				return err
			}
			continue
		}

		if err := copyDesktopSFTPFile(sourceClient, targetClient, childSourcePath, childTargetPath, entry, stats); err != nil {
			return err
		}
	}

	return nil
}

func copyDesktopSFTPFile(sourceClient *sftp.Client, targetClient *sftp.Client, sourcePath string, targetPath string, sourceInfo os.FileInfo, stats *desktopSFTPTransferStats) error {
	remoteFile, err := sourceClient.Open(sourcePath)
	if err != nil {
		return fmt.Errorf("failed to open source file: %w", err)
	}
	defer remoteFile.Close()

	targetFile, err := targetClient.OpenFile(targetPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC)
	if err != nil {
		return fmt.Errorf("failed to create target file: %w", err)
	}

	copied, copyErr := io.Copy(targetFile, remoteFile)
	closeErr := targetFile.Close()
	if copyErr != nil {
		return fmt.Errorf("failed to copy file: %w", copyErr)
	}
	if closeErr != nil {
		return fmt.Errorf("failed to close target file: %w", closeErr)
	}

	_ = targetClient.Chmod(targetPath, sourceInfo.Mode().Perm())
	stats.FilesCopied++
	stats.BytesCopied += copied
	return nil
}

func normalizeDesktopSFTPPath(value string) string {
	value = strings.TrimSpace(strings.ReplaceAll(value, "\\", "/"))
	if value == "" {
		return "/"
	}
	if !strings.HasPrefix(value, "/") {
		value = "/" + value
	}

	return path.Clean(value)
}

func joinDesktopSFTPPath(basePath string, name string) string {
	basePath = normalizeDesktopSFTPPath(basePath)
	name = strings.TrimPrefix(strings.ReplaceAll(name, "\\", "/"), "/")
	return normalizeDesktopSFTPPath(path.Join(basePath, name))
}

func desktopSFTPParent(remotePath string) string {
	remotePath = normalizeDesktopSFTPPath(remotePath)
	if remotePath == "/" {
		return ""
	}

	return path.Dir(remotePath)
}

func desktopSFTPPermissionString(mode os.FileMode) string {
	prefix := "-"
	if mode.IsDir() {
		prefix = "d"
	} else if mode&os.ModeSymlink != 0 {
		prefix = "l"
	}

	perms := ""
	bits := []struct {
		bit  os.FileMode
		char string
	}{
		{0o400, "r"}, {0o200, "w"}, {0o100, "x"},
		{0o040, "r"}, {0o020, "w"}, {0o010, "x"},
		{0o004, "r"}, {0o002, "w"}, {0o001, "x"},
	}
	for _, item := range bits {
		if mode.Perm()&item.bit != 0 {
			perms += item.char
		} else {
			perms += "-"
		}
	}

	return prefix + perms
}

func desktopSFTPBatchError(remotePath string, err error) DesktopSFTPBatchOperationError {
	message := err.Error()
	return DesktopSFTPBatchOperationError{
		Path:    remotePath,
		Error:   message,
		Message: message,
	}
}
