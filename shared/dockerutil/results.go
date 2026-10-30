package dockerutil

import "github.com/easyssh/shared/protocol"

// HTTP and native bindings use these same result shapes. Runtime-specific inputs
// resolve servers from authenticated connections before invoking the common core.
type ContainersResult = protocol.DockerContainersResult
type ImagesResult = protocol.DockerImagesResult
type LogsResult = protocol.DockerLogsResult
type StatsResult = protocol.DockerStatsResult
type ResourcesResult = protocol.DockerResourcesResult
type ImageUpdateResult = protocol.DockerImageUpdateResult
