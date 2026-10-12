//go:build js && wasm

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
)

// The desktop/server Docker client uses the Moby SDK. That SDK pulls in
// platform socket packages which are not available in the WebAssembly target.
// The browser path therefore invokes the remote Docker CLI over the already
// established SSH connection. Docker output remains inside the SSH stream and
// is never exposed to the relay server.
const browserDockerStatsLimit = 50

type browserDockerClient struct{ ssh *ssh.Client }

func (r *runtime) newDockerClient(client *ssh.Client) *browserDockerClient {
	return &browserDockerClient{ssh: client}
}

func (c *browserDockerClient) run(ctx context.Context, command string) ([]byte, error) {
	session, err := c.ssh.NewSession()
	if err != nil {
		return nil, err
	}
	defer session.Close()
	var stdout, stderr bytes.Buffer
	session.Stdout = &stdout
	session.Stderr = &stderr
	stop := context.AfterFunc(ctx, func() { _ = session.Close() })
	defer stop()
	if err := session.Run(command); err != nil {
		message := strings.TrimSpace(stderr.String())
		if message != "" {
			return nil, fmt.Errorf("docker: %s", message)
		}
		return nil, err
	}
	return stdout.Bytes(), nil
}

func (c *browserDockerClient) runJSONLines(ctx context.Context, command string) ([]map[string]any, error) {
	data, err := c.run(ctx, command)
	if err != nil {
		return nil, err
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	result := make([]map[string]any, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var item map[string]any
		if err := json.Unmarshal([]byte(line), &item); err != nil {
			return nil, fmt.Errorf("decode docker output: %w", err)
		}
		result = append(result, item)
	}
	return result, nil
}

func normalizeDockerRef(value string) (string, error) {
	value = strings.TrimSpace(strings.TrimPrefix(value, "/"))
	if value == "" || len(value) > 255 {
		return "", errors.New("container id is required")
	}
	for _, r := range value {
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') ||
			(r >= '0' && r <= '9') || r == '_' || r == '.' || r == '-' || r == ':') {
			return "", errors.New("container id contains invalid characters")
		}
	}
	return value, nil
}

func normalizeDockerTail(value int) int {
	if value <= 0 {
		return 100
	}
	if value > 5000 {
		return 5000
	}
	return value
}

func (r *runtime) dockerCommand(sshClient *ssh.Client, input command) (any, error) {
	ctx, cancel := context.WithTimeout(r.ctx, 50*time.Second)
	defer cancel()
	client := r.newDockerClient(sshClient)
	switch input.Type {
	case "docker_containers":
		all := ""
		if input.All {
			all = " -a"
		}
		items, err := client.runJSONLines(ctx, "docker ps"+all+" --format '{{json .}}'")
		return map[string]any{"data": items, "total": len(items)}, err
	case "docker_images":
		items, err := client.runJSONLines(ctx, "docker images --format '{{json .}}'")
		return map[string]any{"data": items, "total": len(items)}, err
	case "docker_system":
		items, err := client.runJSONLines(ctx, "docker info --format '{{json .}}'")
		if err != nil {
			return nil, err
		}
		if len(items) == 0 {
			return map[string]any{}, nil
		}
		return items[0], nil
	case "docker_stats":
		items, err := client.runJSONLines(ctx, "docker stats --no-stream --format '{{json .}}'")
		return items, err
	case "docker_resources":
		if _, err := client.run(ctx, "docker version --format '{{.Server.Version}}'"); err != nil {
			return nil, err
		}
		stats, err := client.runJSONLines(ctx, "docker stats --no-stream --format '{{json .}}'")
		if err != nil {
			return nil, err
		}
		info, err := client.runJSONLines(ctx, "docker info --format '{{json .}}'")
		if err != nil {
			return nil, err
		}
		var system any = map[string]any{}
		if len(info) > 0 {
			system = info[0]
		}
		return map[string]any{"stats": stats, "systemInfo": system, "dockerInstalled": true, "statsTruncated": len(stats) >= browserDockerStatsLimit, "statsLimit": browserDockerStatsLimit, "runningStatsTotal": len(stats)}, nil
	}
	container, err := normalizeDockerRef(input.Container)
	if err != nil {
		return nil, err
	}
	switch input.Type {
	case "docker_stat":
		items, err := client.runJSONLines(ctx, "docker stats --no-stream --format '{{json .}}' "+container)
		if err != nil {
			return nil, err
		}
		if len(items) == 0 {
			return nil, errors.New("container stats are unavailable")
		}
		return items[0], nil
	case "docker_logs":
		data, err := client.run(ctx, "docker logs --tail "+strconv.Itoa(normalizeDockerTail(input.Tail))+" "+container)
		return map[string]any{"data": string(data), "container_id": container, "lines": input.Tail}, err
	case "docker_start", "docker_stop", "docker_restart", "docker_pause", "docker_unpause":
		action := strings.TrimPrefix(input.Type, "docker_")
		_, err := client.run(ctx, "docker "+action+" "+container)
		return nil, err
	case "docker_remove":
		force := ""
		if input.Force {
			force = " -f"
		}
		_, err := client.run(ctx, "docker rm"+force+" "+container)
		return nil, err
	case "docker_check_update":
		data, err := client.run(ctx, "docker inspect --format '{{json .}}' "+container)
		if err != nil {
			return nil, err
		}
		var inspect map[string]any
		if err := json.Unmarshal(data, &inspect); err != nil {
			return nil, err
		}
		return map[string]any{"hasUpdate": false, "containerName": container, "imageName": inspect["Config"]}, nil
	}
	return nil, errors.New("unsupported Docker operation")
}
