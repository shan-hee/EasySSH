package protocol

import "encoding/hex"

func (a Actor) Valid() bool {
	if a.ID == "" {
		return false
	}
	switch a.Kind {
	case Owner:
		return a.GrantID == ""
	case Device:
		return a.GrantID == "" && a.SessionID != ""
	case Visitor:
		return a.GrantID != "" && a.SessionID != "" && a.ID == a.SessionID
	default:
		return false
	}
}

func (a Action) Shareable() bool {
	switch a {
	case TerminalConnect, FilesList, FilesRead, FilesDownload, FilesUpload,
		FilesWrite, FilesDelete, MonitorRead, DockerRead, DockerManage, ScriptsExecute, AIUse:
		return true
	default:
		return false
	}
}

func ValidConnectionID(id string) bool {
	if len(id) != 32 {
		return false
	}
	decoded, err := hex.DecodeString(id)
	return err == nil && hex.EncodeToString(decoded) == id
}
