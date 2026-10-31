import type { LucideIcon } from "lucide-react"
import {
  Bot,
  Plug,
  MessageCircle,
  ListChecks,
  FileText,
  Monitor,
  ScrollText,
  Settings,
  Terminal,
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
  automation: NavigationItem[]
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

const automation: NavigationItemDefinition[] = [
  {
    titleKey: "chatConnections",
    url: "/dashboard/chat-connections",
    icon: MessageCircle,
    profiles: ["web"],
    requiredCapabilities: ["settings", "ai"],
  },
  {
    titleKey: "mcp",
    url: "/dashboard/mcp",
    icon: Plug,
    profiles: ["web"],
    requiredCapabilities: ["automation"],
  },
]

const systemOrg: NavigationItemDefinition[] = [
  {
    titleKey: "logs",
    url: "/dashboard/logs",
    icon: FileText,
    profiles: ["web"],
    requiredCapabilities: ["audit"],
  },
  {
    titleKey: "systemSettings",
    url: "/dashboard/settings",
    icon: Settings,
    profiles: ["web"],
    requiredCapabilities: ["settings"],
  },
]

export function buildNavigationGroups({
  runtime,
  t,
}: {
  runtime: RuntimeInfo | null | undefined
  t: NavigationTranslation
}): NavigationGroups {
  return {
    workbench: translateNavigationItems(workbench, runtime, t),
    automation: translateNavigationItems(automation, runtime, t),
    systemOrg: translateNavigationItems(systemOrg, runtime, t),
  }
}

function translateNavigationItems(
  items: NavigationItemDefinition[],
  runtime: RuntimeInfo | null | undefined,
  t: NavigationTranslation,
): NavigationItem[] {
  return items.flatMap((item) => {
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
