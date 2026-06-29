import {
  Monitor,
  Server as ServerIcon,
} from "lucide-react"
import {
  SiAlmalinux,
  SiArchlinux,
  SiCentos,
  SiDebian,
  SiFedora,
  SiFreebsd,
  SiGentoo,
  SiKalilinux,
  SiLinux,
  SiLinuxmint,
  SiOpenbsd,
  SiOpensuse,
  SiOpenwrt,
  SiProxmox,
  SiQnap,
  SiRaspberrypi,
  SiRedhat,
  SiRockylinux,
  SiSuse,
  SiSynology,
  SiUbiquiti,
  SiUbuntu,
  SiUnraid,
} from "@icons-pack/react-simple-icons"
import type { Server } from "@/lib/api"
import { cn } from "@/lib/utils"

type SystemIcon = typeof SiDebian

type ServerSystemIconDefinition = {
  label: string
  icon: SystemIcon
  keywords: string[]
}

type LucideSystemIconDefinition = {
  label: string
  color: string
  keywords: string[]
}

const SYSTEM_ICON_DEFINITIONS: ServerSystemIconDefinition[] = [
  { label: "Proxmox", icon: SiProxmox, keywords: ["proxmox", "pve"] },
  { label: "OpenWrt", icon: SiOpenwrt, keywords: ["openwrt", "lede"] },
  { label: "Debian", icon: SiDebian, keywords: ["debian"] },
  { label: "Ubuntu", icon: SiUbuntu, keywords: ["ubuntu"] },
  { label: "AlmaLinux", icon: SiAlmalinux, keywords: ["almalinux", "alma linux"] },
  { label: "Rocky Linux", icon: SiRockylinux, keywords: ["rocky", "rockylinux", "rocky linux"] },
  { label: "CentOS", icon: SiCentos, keywords: ["centos", "cent os"] },
  { label: "Fedora", icon: SiFedora, keywords: ["fedora"] },
  { label: "Red Hat", icon: SiRedhat, keywords: ["redhat", "red hat", "rhel"] },
  { label: "Arch Linux", icon: SiArchlinux, keywords: ["archlinux", "arch linux"] },
  { label: "Linux Mint", icon: SiLinuxmint, keywords: ["linux mint", "linuxmint"] },
  { label: "Kali Linux", icon: SiKalilinux, keywords: ["kali", "kali linux"] },
  { label: "openSUSE", icon: SiOpensuse, keywords: ["opensuse", "open suse"] },
  { label: "SUSE", icon: SiSuse, keywords: ["suse", "sles"] },
  { label: "Gentoo", icon: SiGentoo, keywords: ["gentoo"] },
  { label: "FreeBSD", icon: SiFreebsd, keywords: ["freebsd", "free bsd"] },
  { label: "OpenBSD", icon: SiOpenbsd, keywords: ["openbsd", "open bsd"] },
  { label: "Synology DSM", icon: SiSynology, keywords: ["synology dsm", "dsm"] },
  { label: "QNAP QTS", icon: SiQnap, keywords: ["qnap qts", "qts"] },
  { label: "Unraid", icon: SiUnraid, keywords: ["unraid"] },
  { label: "Raspberry Pi OS", icon: SiRaspberrypi, keywords: ["raspberry pi os", "raspbian"] },
  { label: "UniFi OS", icon: SiUbiquiti, keywords: ["unifi os", "edgeos"] },
  { label: "Linux", icon: SiLinux, keywords: ["linux", "gnu/linux"] },
]

const LUCIDE_SYSTEM_ICON_DEFINITIONS: LucideSystemIconDefinition[] = [
  { label: "Windows", color: "#0078D4", keywords: ["windows", "windows server", "winserver"] },
]

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/[_-]+/g, " ")
}

function buildSystemIconSearchText(server: Server) {
  return normalizeSearchText([
    server.os,
    server.name,
    server.group,
    server.description,
    server.host,
    ...(server.tags || []),
  ].filter(Boolean).join(" "))
}

function matchesKeyword(searchText: string, keyword: string) {
  return searchText.includes(normalizeSearchText(keyword))
}

function findSystemIcon(server: Server) {
  const searchText = buildSystemIconSearchText(server)

  for (const definition of SYSTEM_ICON_DEFINITIONS) {
    if (definition.keywords.some((keyword) => matchesKeyword(searchText, keyword))) {
      return definition
    }
  }

  return null
}

function findLucideSystemIcon(server: Server) {
  const searchText = buildSystemIconSearchText(server)

  for (const definition of LUCIDE_SYSTEM_ICON_DEFINITIONS) {
    if (definition.keywords.some((keyword) => matchesKeyword(searchText, keyword))) {
      return definition
    }
  }

  return null
}

export function ServerSystemIcon({
  server,
  className,
  size = 20,
}: {
  server: Server
  className?: string
  size?: number
}) {
  const match = findSystemIcon(server)

  if (match) {
    const Icon = match.icon

    return (
      <Icon
        aria-hidden="true"
        className={cn("flex-shrink-0", className)}
        color="default"
        focusable="false"
        size={size}
        title={match.label}
      />
    )
  }

  const lucideSystemIcon = findLucideSystemIcon(server)

  if (lucideSystemIcon) {
    return (
      <Monitor
        aria-hidden="true"
        className={cn("flex-shrink-0", className)}
        color={lucideSystemIcon.color}
        focusable="false"
        size={size}
      />
    )
  }

  return (
    <ServerIcon
      aria-hidden="true"
      className={cn("flex-shrink-0 text-muted-foreground transition-colors group-hover:text-primary", className)}
      focusable="false"
      size={size}
    />
  )
}
