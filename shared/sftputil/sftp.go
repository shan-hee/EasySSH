package sftputil

import (
	"os"
	"path"
	"strings"
)

const MaxTextFileBytes = 5 << 20

func NormalizePath(value string) string {
	value = strings.TrimSpace(strings.ReplaceAll(value, "\\", "/"))
	if value == "" {
		return "/"
	}
	if !strings.HasPrefix(value, "/") {
		value = "/" + value
	}

	return path.Clean(value)
}

func JoinPath(basePath string, name string) string {
	basePath = NormalizePath(basePath)
	name = strings.TrimPrefix(strings.ReplaceAll(name, "\\", "/"), "/")
	return NormalizePath(path.Join(basePath, name))
}

func ParentPath(remotePath string) string {
	remotePath = NormalizePath(remotePath)
	if remotePath == "/" {
		return ""
	}

	return path.Dir(remotePath)
}

func PermissionString(mode os.FileMode) string {
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
