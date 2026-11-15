package platform

import "github.com/easyssh/shared/protocol"

type Capability = protocol.RuntimeCapability

const (
	CapabilityServers        Capability = "servers"
	CapabilityTerminal       Capability = "terminal"
	CapabilitySFTP           Capability = "sftp"
	CapabilityTransfers      Capability = "transfers"
	CapabilityScripts        Capability = "scripts"
	CapabilityAutomation     Capability = "automation"
	CapabilityMonitoring     Capability = "monitoring"
	CapabilityDocker         Capability = "docker"
	CapabilityAI             Capability = "ai"
	CapabilityActivityLog    Capability = "activity_log"
	CapabilityBackup         Capability = "backup"
	CapabilitySettings       Capability = "settings"
	CapabilityAudit          Capability = "audit"
	CapabilityLoginLogs      Capability = "login_logs"
	CapabilityNotifications  Capability = "notifications"
	CapabilitySecurityPolicy Capability = "security_policy"
)

type RuntimeInfo = protocol.RuntimeInfo

type RuntimeOptions struct {
	DataDir string
	Version string
}

func NewRuntimeInfo(options RuntimeOptions) RuntimeInfo {
	return RuntimeInfo{
		Profile:    protocol.RuntimeProfileWeb,
		Principal:  protocol.RuntimePrincipal{Kind: "owner"},
		SingleUser: true,
		Portable:   false,
		Managed:    true,
		DataDir:    options.DataDir,
		Version:    options.Version,
		Capabilities: capabilitiesMap(
			CapabilityServers,
			CapabilityTerminal,
			CapabilitySFTP,
			CapabilityTransfers,
			CapabilityScripts,
			CapabilityAutomation,
			CapabilityMonitoring,
			CapabilityDocker,
			CapabilityAI,
			CapabilityActivityLog,
			CapabilityBackup,
			CapabilitySettings,
			CapabilityAudit,
			CapabilityLoginLogs,
			CapabilityNotifications,
			CapabilitySecurityPolicy,
		),
	}
}

func capabilitiesMap(capabilities ...Capability) map[Capability]bool {
	result := make(map[Capability]bool, len(capabilities))
	for _, capability := range capabilities {
		result[capability] = true
	}
	return result
}
