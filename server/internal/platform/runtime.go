package platform

import (
	"github.com/easyssh/shared/protocol"
	"os"
	"strings"
)

type RuntimeProfile = protocol.RuntimeProfile

const (
	RuntimeProfileWeb     RuntimeProfile = "web"
	RuntimeProfileDesktop RuntimeProfile = "desktop"
)

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
	CapabilityDesktopDataDir Capability = "desktop_data_dir"
	CapabilityOpenDataDir    Capability = "open_data_dir"
	CapabilityPortableMode   Capability = "portable_mode"
)

type Principal = protocol.RuntimePrincipal

type RuntimeInfo = protocol.RuntimeInfo

type RuntimeOptions struct {
	Profile RuntimeProfile
	DataDir string
	Version string
}

func ResolveRuntimeProfile(value string) RuntimeProfile {
	switch RuntimeProfile(strings.ToLower(strings.TrimSpace(value))) {
	case RuntimeProfileDesktop:
		return RuntimeProfileDesktop
	default:
		return RuntimeProfileWeb
	}
}

func ProfileFromEnvironment() RuntimeProfile {
	return ResolveRuntimeProfile(os.Getenv("EASYSSH_RUNTIME_PROFILE"))
}

func NewRuntimeInfo(options RuntimeOptions) RuntimeInfo {
	profile := options.Profile
	if profile == "" {
		profile = RuntimeProfileWeb
	}

	if profile == RuntimeProfileDesktop {
		return RuntimeInfo{
			Profile:    RuntimeProfileDesktop,
			Principal:  Principal{Kind: "local_owner"},
			SingleUser: true,
			Portable:   true,
			Managed:    false,
			DataDir:    options.DataDir,
			Version:    options.Version,
			Capabilities: capabilitiesMap(
				CapabilityServers,
				CapabilityTerminal,
				CapabilitySFTP,
				CapabilityTransfers,
				CapabilityScripts,
				CapabilityMonitoring,
				CapabilityDocker,
				CapabilityAI,
				CapabilityActivityLog,
				CapabilityBackup,
				CapabilitySettings,
				CapabilityDesktopDataDir,
				CapabilityOpenDataDir,
				CapabilityPortableMode,
			),
		}
	}

	return RuntimeInfo{
		Profile:    RuntimeProfileWeb,
		Principal:  Principal{Kind: "owner"},
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
