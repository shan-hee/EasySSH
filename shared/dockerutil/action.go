package dockerutil

import (
	"context"
	"errors"
	"fmt"
	"github.com/easyssh/shared/protocol"
	"strings"
	"unicode/utf8"

	mobyclient "github.com/moby/moby/client"
)

var ErrMutationOutcomeUnknown = errors.New("docker mutation outcome unknown")

// Apply performs one API mutation. Read-only API negotiation does not count as
// attempting the mutation; the transport tracks only its POST/DELETE request.
func (c *Client) Apply(ctx context.Context, action protocol.DockerAction, containerID string, force bool) error {
	if !action.Valid() || force && action != protocol.DockerActionRemove {
		return errors.New("invalid Docker action")
	}
	ref, err := NormalizeContainerRef(containerID)
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	observation := &mutationObservation{}
	ctx = context.WithValue(ctx, mutationContextKey{}, observation)
	switch action {
	case protocol.DockerActionStart:
		_, err = c.api.ContainerStart(ctx, ref, mobyclient.ContainerStartOptions{})
	case protocol.DockerActionStop:
		_, err = c.api.ContainerStop(ctx, ref, mobyclient.ContainerStopOptions{})
	case protocol.DockerActionRestart:
		_, err = c.api.ContainerRestart(ctx, ref, mobyclient.ContainerRestartOptions{})
	case protocol.DockerActionPause:
		_, err = c.api.ContainerPause(ctx, ref, mobyclient.ContainerPauseOptions{})
	case protocol.DockerActionUnpause:
		_, err = c.api.ContainerUnpause(ctx, ref, mobyclient.ContainerUnpauseOptions{})
	case protocol.DockerActionRemove:
		_, err = c.api.ContainerRemove(ctx, ref, mobyclient.ContainerRemoveOptions{Force: force})
	}
	if err != nil {
		if status := observation.status.Load(); status >= 400 {
			return &daemonResponseError{status: int(status), cause: err}
		}
		if observation.attempted.Load() && observation.status.Load() == 0 {
			return errors.Join(ErrMutationOutcomeUnknown, err)
		}
	}
	return err
}

type daemonResponseError struct {
	status int
	cause  error
}

func (e *daemonResponseError) Error() string {
	return fmt.Sprintf("Docker API returned %d: %v", e.status, e.cause)
}
func (e *daemonResponseError) Unwrap() error { return e.cause }

func Outcome(err error) (status, code, message string) {
	if err == nil {
		return "succeeded", "", ""
	}
	status, code = "failed", "docker_action_failed"
	var response *daemonResponseError
	switch {
	case errors.As(err, &response): // A daemon response wins a later local cancellation.
	case errors.Is(err, ErrMutationOutcomeUnknown):
		status, code = "unknown", "docker_outcome_unknown"
	case errors.Is(err, context.Canceled):
		status, code = "canceled", "docker_action_canceled"
	case errors.Is(err, context.DeadlineExceeded):
		status, code = "timeout", "docker_action_timeout"
	}
	message = strings.ToValidUTF8(err.Error(), "�")
	if len(message) > 4096 {
		message = message[:4096]
		for !utf8.ValidString(message) {
			message = message[:len(message)-1]
		}
	}
	return status, code, message
}
