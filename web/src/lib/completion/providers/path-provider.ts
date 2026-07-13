import type { SftpDirectoryApi } from "@/lib/session/sftp-directory"
import type { CompletionContext, CompletionItem, CompletionProvider } from "../types"
import {
  getCommandNameFromToken,
  isShellAssignmentToken,
  isShellOptionToken,
  stripAnsi,
  stripOuterQuote,
  unescapeShellToken,
} from "../utils"

interface PathProviderOptions {
  serverId?: string
  api?: SftpDirectoryApi
  getFallbackCwd?: () => string | undefined
}

interface CachedDirectory {
  expiresAt: number
  entries: PathDirectoryEntry[]
}

interface PathDirectoryEntry {
  name: string
  is_dir: boolean
}

interface PathTarget {
  directory: string
  prefix: string
  replacementBase: string
  quotePrefix: string
  quoted: "single" | "double" | null
  replaceStart: number
  replaceEnd: number
}

interface CommandInfo {
  command: string
  index: number
  isPathCommand: boolean
}

const DIRECTORY_CACHE_TTL_MS = 5000

export const PATH_COMPLETION_COMMANDS = new Set([
  "cat",
  "cd",
  "chmod",
  "chown",
  "cp",
  "du",
  "emacs",
  "file",
  "find",
  "grep",
  "head",
  "less",
  "ln",
  "ls",
  "mkdir",
  "more",
  "mv",
  "nano",
  "pushd",
  "rg",
  "rm",
  "rmdir",
  "rsync",
  "scp",
  "sed",
  "source",
  "tail",
  "tar",
  "touch",
  "tree",
  "vi",
  "vim",
])

const DIRECTORY_ONLY_COMMANDS = new Set(["cd", "mkdir", "pushd", "rmdir"])
const COMMAND_PREFIXES = new Set(["command", "env", "nice", "nohup", "sudo", "time"])
const PATH_PREFIX_PATTERN = /^(?:\.{1,2}(?:\/|$)|~(?:\/|$)|\/)/
const PREFERRED_DIRECTORY_NAMES = new Map([
  ["src", 10],
  ["app", 9],
  ["web", 8],
  ["server", 8],
  ["api", 7],
  ["config", 6],
  ["logs", 6],
  ["log", 6],
  ["tmp", 5],
  ["var", 5],
  ["etc", 5],
  ["home", 5],
])

export class PathProvider implements CompletionProvider {
  name = "path"
  priority = 30
  enabled = true
  timeoutMs = 1200

  private serverId?: string
  private api?: SftpDirectoryApi
  private getFallbackCwd?: () => string | undefined
  private directoryCache = new Map<string, CachedDirectory>()
  private directoryRequests = new Map<string, Promise<PathDirectoryEntry[]>>()

  constructor(options: PathProviderOptions = {}) {
    this.updateOptions(options)
  }

  updateOptions(options: PathProviderOptions): void {
    const previousServerId = this.serverId
    const previousApi = this.api

    this.serverId = options.serverId
    this.api = options.api
    this.getFallbackCwd = options.getFallbackCwd

    if (previousServerId !== this.serverId || previousApi !== this.api) {
      this.clear()
    }
  }

  clear(): void {
    this.directoryCache.clear()
    this.directoryRequests.clear()
  }

  shouldTrigger(context: CompletionContext): boolean {
    if (!this.serverId || !this.api) {
      return false
    }

    const commandInfo = this.resolveCommandInfo(context.tokens)
    if (!commandInfo || context.currentTokenIndex <= commandInfo.index) {
      return false
    }

    const currentWord = context.currentWord
    if (isShellOptionToken(currentWord)) {
      return false
    }

    return commandInfo.isPathCommand ||
      PATH_PREFIX_PATTERN.test(stripOuterQuote(currentWord))
  }

  async getCompletions(context: CompletionContext): Promise<CompletionItem[]> {
    if (!this.shouldTrigger(context) || !this.serverId || !this.api) {
      return []
    }

    const commandInfo = this.resolveCommandInfo(context.tokens)
    if (!commandInfo) {
      return []
    }

    const foldersOnly = DIRECTORY_ONLY_COMMANDS.has(commandInfo.command)
    const target = this.resolvePathTarget(context)
    const cacheKey = `${this.serverId}:${target.directory}`
    const now = Date.now()
    const cached = this.directoryCache.get(cacheKey)

    let entries: PathDirectoryEntry[]
    if (cached && cached.expiresAt > now) {
      entries = cached.entries
    } else {
      let request = this.directoryRequests.get(cacheKey)
      if (!request) {
        request = this.api.listDirectory(this.serverId, target.directory)
          .then((response) => response.files.map((file) => ({
            name: file.name,
            is_dir: file.is_dir,
          })))
        this.directoryRequests.set(cacheKey, request)
        const clearPendingRequest = () => {
          if (this.directoryRequests.get(cacheKey) === request) {
            this.directoryRequests.delete(cacheKey)
          }
        }
        void request.then(clearPendingRequest, clearPendingRequest)
      }
      entries = await request

      this.directoryCache.set(cacheKey, {
        expiresAt: Date.now() + DIRECTORY_CACHE_TTL_MS,
        entries,
      })
    }

    const normalizedPrefix = unescapeShellToken(target.prefix).toLowerCase()
    return entries
      .filter((entry) => !foldersOnly || entry.is_dir)
      .filter((entry) => entry.name.toLowerCase().startsWith(normalizedPrefix))
      .sort((a, b) => this.compareEntries(a, b, target.prefix))
      .map((entry) => {
        const replacement = `${target.quotePrefix}${target.replacementBase}${this.escapePathSegment(entry.name, target.quoted)}${entry.is_dir ? "/" : ""}`
        return {
          text: replacement,
          displayText: `${entry.name}${entry.is_dir ? "/" : ""}`,
          type: entry.is_dir ? "directory" : "file",
          source: "path",
          description: target.directory,
          priority: this.priority + (entry.is_dir ? 3 : 0),
          providerName: "path",
          replaceStart: target.replaceStart,
          replaceEnd: target.replaceEnd,
        } satisfies CompletionItem
      })
      .map((item) => ({
        ...item,
        score: this.calculateScore(item, normalizedPrefix),
      }))
  }

  private resolveCommandInfo(tokens: string[]): CommandInfo | null {
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index]
      if (!token || isShellOptionToken(token) || isShellAssignmentToken(token)) {
        continue
      }

      const command = getCommandNameFromToken(token)
      if (!command || COMMAND_PREFIXES.has(command)) {
        continue
      }

      return {
        command,
        index,
        isPathCommand: PATH_COMPLETION_COMMANDS.has(command),
      }
    }

    return null
  }

  private resolveCwd(context: CompletionContext): string {
    const explicitCwd = this.normalizeAbsoluteDirectory(context.cwd)
    const promptCwd = this.extractCwdFromPrompt(context.promptText)
    const fallbackCwd = this.normalizeAbsoluteDirectory(this.getFallbackCwd?.())
    if (explicitCwd) {
      return explicitCwd
    }
    return promptCwd || fallbackCwd || "/"
  }

  private extractCwdFromPrompt(promptText?: string): string | null {
    if (!promptText) {
      return null
    }

    const withoutAnsi = stripAnsi(promptText)
    const promptWithoutMarker = withoutAnsi
      .replace(/[$#%>❯❮➜➤›]\s*$/, "")
      .trim()
      .replace(/[\])]$/, "")
    const cwdMatch = promptWithoutMarker.match(/(?:^|[\s:])(~(?:\/[^\s)\]]*)?|\/[^\s)\]]*)\s*$/)
    if (!cwdMatch) {
      return null
    }

    const cwd = cwdMatch[1]
    if (cwd === "~") {
      return this.resolveHomeDirectory()
    }
    if (cwd.startsWith("~/")) {
      return this.normalizePath(`${this.resolveHomeDirectory()}/${cwd.slice(2)}`)
    }

    return this.normalizeAbsoluteDirectory(cwd)
  }

  private normalizeAbsoluteDirectory(path?: string): string | null {
    if (!path) {
      return null
    }

    const trimmed = path.trim()
    if (!trimmed) {
      return null
    }

    if (!trimmed.startsWith("/")) {
      return null
    }

    const normalized = trimmed.replace(/\/+/g, "/")
    return normalized.length > 1 ? normalized.replace(/\/$/, "") : normalized
  }

  private resolveHomeDirectory(): string {
    const fallback = this.normalizeAbsoluteDirectory(this.getFallbackCwd?.())
    if (!fallback) {
      return "/"
    }

    const segments = fallback.split("/").filter(Boolean)
    if (segments[0] === "root") {
      return "/root"
    }
    if ((segments[0] === "home" || segments[0] === "Users") && segments[1]) {
      return `/${segments[0]}/${segments[1]}`
    }

    return "/"
  }

  private resolvePathTarget(context: CompletionContext): PathTarget {
    const cwd = this.resolveCwd(context)
    const currentWord = context.currentWord
    const wordPrefix = currentWord.slice(
      0,
      Math.max(0, context.cursorPosition - context.currentWordStart)
    )
    const quoted = this.getQuoteStyle(currentWord)
    const unquotedWord = stripOuterQuote(wordPrefix)
    const unescapedWord = unescapeShellToken(unquotedWord)
    const lastSlashIndex = unescapedWord.lastIndexOf("/")
    const typedDirectory = lastSlashIndex >= 0 ? unescapedWord.slice(0, lastSlashIndex + 1) : ""
    const prefix = lastSlashIndex >= 0 ? unescapedWord.slice(lastSlashIndex + 1) : unescapedWord
    const directory = this.resolveDirectory(typedDirectory, cwd)
    const replacementBase = lastSlashIndex >= 0 ? unquotedWord.slice(0, this.findEscapedSlashBaseLength(unquotedWord)) : ""

    return {
      directory,
      prefix,
      replacementBase,
      quotePrefix: quoted === "single" ? "'" : quoted === "double" ? '"' : "",
      quoted,
      replaceStart: context.currentWordStart,
      replaceEnd: context.currentWordEnd,
    }
  }

  private compareEntries(a: PathDirectoryEntry, b: PathDirectoryEntry, prefix: string): number {
    if (a.is_dir !== b.is_dir) {
      return a.is_dir ? -1 : 1
    }

    const userTypedHiddenPrefix = prefix.startsWith(".")
    const aHidden = a.name.startsWith(".")
    const bHidden = b.name.startsWith(".")
    if (!userTypedHiddenPrefix && aHidden !== bHidden) {
      return aHidden ? 1 : -1
    }

    const aLower = a.name.toLowerCase()
    const bLower = b.name.toLowerCase()
    const prefixLower = prefix.toLowerCase()
    const aExact = aLower === prefixLower
    const bExact = bLower === prefixLower
    if (aExact !== bExact) {
      return aExact ? -1 : 1
    }

    return aLower.localeCompare(bLower)
  }

  private resolveDirectory(typedDirectory: string, cwd: string): string {
    if (!typedDirectory) {
      return cwd
    }

    if (typedDirectory === "~/" || typedDirectory === "~") {
      return this.resolveHomeDirectory()
    }

    if (typedDirectory.startsWith("~/")) {
      return this.normalizePath(`${this.resolveHomeDirectory()}/${typedDirectory.slice(2)}`)
    }

    if (typedDirectory.startsWith("/")) {
      return this.normalizePath(typedDirectory)
    }

    return this.normalizePath(`${cwd}/${typedDirectory}`)
  }

  private normalizePath(path: string): string {
    const parts: string[] = []
    for (const part of path.split("/")) {
      if (!part || part === ".") {
        continue
      }
      if (part === "..") {
        parts.pop()
        continue
      }
      parts.push(part)
    }

    return `/${parts.join("/")}`
  }

  private findEscapedSlashBaseLength(value: string): number {
    let inSingleQuote = false
    let inDoubleQuote = false
    let escaped = false
    let lastSlashIndex = -1

    for (let index = 0; index < value.length; index++) {
      const char = value[index]

      if (escaped) {
        if (char === "/") {
          lastSlashIndex = index
        }
        escaped = false
        continue
      }

      if (char === "\\") {
        escaped = true
        continue
      }

      if (char === "'" && !inDoubleQuote) {
        inSingleQuote = !inSingleQuote
        continue
      }

      if (char === '"' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote
        continue
      }

      if (char === "/") {
        lastSlashIndex = index
      }
    }

    return lastSlashIndex >= 0 ? lastSlashIndex + 1 : 0
  }

  private getQuoteStyle(value: string): "single" | "double" | null {
    if (value.startsWith("'")) return "single"
    if (value.startsWith('"')) return "double"
    return null
  }

  private escapePathSegment(value: string, quoted: "single" | "double" | null): string {
    if (quoted === "single") {
      return value.replace(/'/g, "'\\''")
    }

    if (quoted === "double") {
      return value.replace(/(["\\$`])/g, "\\$1")
    }

    return value.replace(/([\s!"#$&'()*,:;<=>?@[\\\]^`{|}])/g, "\\$1")
  }

  private calculateScore(item: CompletionItem, prefix: string): number {
    const rawDisplayText = item.displayText ?? item.text
    const displayText = rawDisplayText.toLowerCase()
    const name = displayText.replace(/\/$/, "")
    const isHidden = name.startsWith(".")
    const hiddenPenalty = isHidden && !prefix.startsWith(".") ? 25 : 0
    const preferredBonus = item.type === "directory"
      ? PREFERRED_DIRECTORY_NAMES.get(name) ?? 0
      : 0

    if (!prefix) {
      return (item.type === "directory" ? 82 : 78) + preferredBonus - hiddenPenalty
    }

    if (displayText === prefix || displayText === `${prefix}/`) {
      return 115 + preferredBonus - hiddenPenalty
    }

    if (displayText.startsWith(prefix)) {
      return (item.type === "directory" ? 102 : 96) + preferredBonus - hiddenPenalty
    }

    return (item.type === "directory" ? 72 : 68) + preferredBonus - hiddenPenalty
  }
}
