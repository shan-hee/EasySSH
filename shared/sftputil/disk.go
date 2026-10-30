package sftputil

import (
	"errors"
	"github.com/easyssh/shared/protocol"
)

// FilesystemUsage follows POSIX statvfs: block counts use fragment size, and
// reserved free blocks are excluded from both used data and available space.
func FilesystemUsage(remotePath string, blocks, free, available, fragmentSize uint64) (protocol.DiskUsage, error) {
	if fragmentSize == 0 || blocks > ^uint64(0)/fragmentSize || free > blocks || available > free {
		return protocol.DiskUsage{}, errors.New("invalid remote filesystem statistics")
	}
	result := protocol.DiskUsage{Path: remotePath, Total: blocks * fragmentSize, Used: (blocks - free) * fragmentSize, Available: available * fragmentSize}
	if result.Total > 0 {
		result.UsedPercent = float64(result.Used) / float64(result.Total) * 100
	}
	return result, nil
}
