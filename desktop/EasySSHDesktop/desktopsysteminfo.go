package main

import (
	"fmt"

	"github.com/easyssh/shared/systeminfo"
)

func (s *DesktopServerService) SystemSnapshot(serverID, kind string) (systeminfo.Snapshot, error) {
	command, err := systeminfo.Command(kind)
	if err != nil {
		return systeminfo.Snapshot{}, err
	}
	result, err := s.ExecuteCommand(DesktopServerCommandInput{ServerID: serverID, Command: command, TimeoutMs: 15000})
	if err != nil {
		return systeminfo.Snapshot{}, err
	}
	if result.ExitCode != 0 {
		return systeminfo.Snapshot{}, fmt.Errorf("system snapshot failed: %s", result.Output)
	}
	return systeminfo.Parse(kind, result.Output), nil
}
