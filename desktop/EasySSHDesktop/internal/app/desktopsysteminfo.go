package app

import (
	"context"
	"fmt"

	"github.com/easyssh/shared/systeminfo"
)

func (s *DesktopServerService) SystemSnapshot(serverID, kind string) (systeminfo.Snapshot, error) {
	command, err := systeminfo.Command(kind)
	if err != nil {
		return systeminfo.Snapshot{}, err
	}
	result, err := s.executeCommandContext(context.Background(), DesktopServerCommandInput{ServerID: serverID, Command: command, TimeoutMs: 15000})
	if err != nil {
		return systeminfo.Snapshot{}, err
	}
	if result.Outcome != "succeeded" {
		return systeminfo.Snapshot{}, fmt.Errorf("system snapshot %s: %s", result.Outcome, result.Error)
	}
	return systeminfo.Parse(kind, desktopAIFirstNonEmpty(result.Error, result.Output)), nil
}
