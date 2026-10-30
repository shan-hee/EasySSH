package app

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/easyssh/shared/protocol"
	"time"

	"github.com/easyssh/shared/dockerutil"
	"github.com/google/uuid"
)

func (s *DesktopDockerService) containerAction(input DesktopDockerContainerInput, action protocol.DockerAction, force bool) (protocol.DockerActionResult, error) {
	return s.runAction(input, action, force, func(ctx context.Context, serverID, containerID string) error {
		client, closeClient, err := s.openClient(ctx, serverID)
		if err != nil {
			return err
		}
		defer closeClient()
		return client.Apply(ctx, action, containerID, force)
	})
}

func (s *DesktopDockerService) runAction(input DesktopDockerContainerInput, action protocol.DockerAction, force bool, execute func(context.Context, string, string) error) (protocol.DockerActionResult, error) {
	var result protocol.DockerActionResult
	serverID, err := normalizeDesktopDockerServerID(input.ServerID)
	if err != nil {
		return result, err
	}
	containerID, err := dockerutil.NormalizeContainerRef(input.ContainerID)
	if err != nil {
		return result, err
	}
	if !action.Valid() || force && action != protocol.DockerActionRemove {
		return result, errors.New("invalid Docker action")
	}
	if s.tasks == nil {
		return result, errors.New("task service is unavailable")
	}
	ctx, done, err := s.beginOperation(context.Background())
	if err != nil {
		return result, err
	}
	defer done()
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	result = protocol.DockerActionResult{TaskID: uuid.NewString(), ServerID: serverID, ContainerID: containerID, Action: action}
	payload, err := json.Marshal(struct {
		Action      protocol.DockerAction `json:"action"`
		ContainerID string                `json:"container_id"`
		Force       bool                  `json:"force"`
	}{action, containerID, force})
	if err != nil {
		return result, err
	}
	if _, err := s.tasks.create(desktopTaskCreateInput{
		ID: result.TaskID, Actor: desktopLocalActor(), SourceType: "desktop_docker", SourceID: result.TaskID,
		TaskType: "docker_" + string(action), Title: "Docker " + string(action),
		ServerID: serverID, Resource: containerID, PayloadJSON: string(payload), TotalCount: 1,
		Cancelable: false, Retryable: false,
	}); err != nil {
		// No transport has been opened. A creation error cannot repeat a remote
		// effect, even if the local database's commit response was lost.
		return result, err
	}
	if err := s.tasks.start(result.TaskID, "docker_"+string(action)); err != nil {
		return s.finishAction(result, err)
	}
	if err := ctx.Err(); err != nil {
		return s.finishAction(result, err)
	}
	return s.finishAction(result, execute(ctx, serverID, containerID))
}

func (s *DesktopDockerService) finishAction(result protocol.DockerActionResult, operationErr error) (protocol.DockerActionResult, error) {
	result.Status, result.ErrorCode, result.ErrorMessage = dockerutil.Outcome(operationErr)
	succeeded, failed := 0, 0
	if result.Status == "succeeded" {
		succeeded = 1
	}
	if result.Status == "failed" || result.Status == "timeout" {
		failed = 1
	}
	// This DTO contains only fixed scalar fields, with no custom marshalers.
	encoded, _ := json.Marshal(result)
	if err := s.tasks.complete(result.TaskID, result.Status, string(encoded), result.ErrorCode, result.ErrorMessage, succeeded, failed); err != nil {
		return result, err
	}
	return result, nil
}
