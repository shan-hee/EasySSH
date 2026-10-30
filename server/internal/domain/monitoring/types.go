package monitoring

import "github.com/easyssh/shared/protocol"

// Public monitoring summaries are defined by the HTTP contract. Streaming metrics remain Protobuf.
type ServerResourceSummary = protocol.MonitoringServerResource
type CPUSummary = protocol.MonitoringCPUSummary
type MemorySummary = protocol.MonitoringMemorySummary
type DiskSummary = protocol.MonitoringDiskSummary
type NetworkSummary = protocol.MonitoringNetworkSummary
type LocationSummary = protocol.MonitoringLocationSummary
type AllServersResources = protocol.MonitoringResources
