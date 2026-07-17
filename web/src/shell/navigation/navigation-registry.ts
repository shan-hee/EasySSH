import type { LucideIcon } from "lucide-react"
import {
  Bot,
  ListChecks,
  FileText,
  Monitor,
  ScrollText,
  Settings,
  Terminal,
  Users,
} from "lucide-react"
import type { AppCapability, RuntimeInfo, RuntimeProfile } from "@/shell/runtime/types"
import { hasAllCapabilities } from "@/shell/runtime/capabilities"

export type NavigationTranslation = (key: string) => string

export interface NavigationItemDefinition {
  titleKey: string
  url: string
  icon?: LucideIcon
  requiredCapabilities?: AppCapability[]
  profiles?: RuntimeProfile[]
	requiredPermission?: string
  isActive?: boolean
}

export interface NavigationItem {
  title: string
  url: string
  icon?: LucideIcon
  isActive?: boolean
}

export interface NavigationGroups {
  workbench: NavigationItem[]
  systemOrg: NavigationItem[]
}

const workbench: NavigationItemDefinition[] = [
  {
    titleKey: "console",
    url: "/dashboard",
    icon: Monitor,
    isActive: true,
    profiles: ["web"],
    requiredCapabilities: ["servers"],
  },
  {
    titleKey: "aiAssistant",
    url: "/dashboard/ai-assistant",
    icon: Bot,
    requiredCapabilities: ["ai"],
  },
  {
    titleKey: "terminal",
    url: "/dashboard/terminal",
    icon: Terminal,
    requiredCapabilities: ["servers", "terminal"],
  },
  {
    titleKey: "scripts",
    url: "/dashboard/scripts",
    icon: ScrollText,
    requiredCapabilities: ["scripts"],
  },
  {
    titleKey: "tasks",
    url: "/dashboard/tasks",
    icon: ListChecks,
    profiles: ["web"],
    requiredCapabilities: ["automation"],
  },
  {
    titleKey: "operationLogs",
    url: "/dashboard/operation-logs",
    icon: ScrollText,
    profiles: ["web"],
    requiredCapabilities: ["activity_log"],
  },
]

const systemOrg: NavigationItemDefinition[] = [
  {
    titleKey: "userManagement",
    url: "/dashboard/users",
    icon: Users,
	requiredPermission: "user:manage",
    profiles: ["web"],
    requiredCapabilities: ["users"],
  },
  {
    titleKey: "logs",
    url: "/dashboard/logs",
    icon: FileText,
	requiredPermission: "audit:view",
    profiles: ["web"],
    requiredCapabilities: ["audit"],
  },
  {
    titleKey: "systemSettings",
    url: "/dashboard/settings",
    icon: Settings,
	requiredPermission: "system:settings",
    profiles: ["web"],
    requiredCapabilities: ["settings"],
  },
]

export function buildNavigationGroups({
  runtime,
	isOwner,
	permissions,
  t,
}: {
  runtime: RuntimeInfo | null | undefined
	isOwner: boolean
	permissions: readonly string[]
  t: NavigationTranslation
}): NavigationGroups {
  return {
    workbench: translateNavigationItems(workbench, runtime, isOwner, permissions, t),
    systemOrg: translateNavigationItems(systemOrg, runtime, isOwner, permissions, t),
  }
}

function translateNavigationItems(
  items: NavigationItemDefinition[],
  runtime: RuntimeInfo | null | undefined,
	isOwner: boolean,
	permissions: readonly string[],
  t: NavigationTranslation,
): NavigationItem[] {
  return items.flatMap((item) => {
		if (item.requiredPermission && !isOwner && !permissions.includes(item.requiredPermission)) {
      return []
    }
    if (!matchesCapabilities(runtime, item.requiredCapabilities)) {
      return []
    }
    if (!matchesProfiles(runtime, item.profiles)) {
      return []
    }

    return [{
      title: t(item.titleKey),
      url: item.url,
      icon: item.icon,
      isActive: item.isActive,
    }]
  })
}

function matchesProfiles(
  runtime: RuntimeInfo | null | undefined,
  profiles: RuntimeProfile[] | readonly RuntimeProfile[] | undefined,
) {
  if (!profiles || profiles.length === 0) {
    return true
  }
  if (!runtime) {
    return false
  }

  return profiles.includes(runtime.profile)
}

function matchesCapabilities(
  runtime: RuntimeInfo | null | undefined,
  capabilities: AppCapability[] | readonly AppCapability[] | undefined,
) {
  if (!runtime) {
    return true
  }

  return hasAllCapabilities(runtime, capabilities)
}
