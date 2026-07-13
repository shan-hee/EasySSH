/**
 * 终端补全工具函数
 */

import type { Terminal } from "@xterm/xterm"
import type { CompletionContext, CompletionTriggerKind } from "./types"

type TerminalWithRenderDimensions = Terminal & {
  _core?: {
    _renderService?: {
      dimensions?: {
        css?: {
          cell?: {
            width: number
            height: number
          }
        }
      }
    }
  }
}

function getTerminalPadding(container?: HTMLElement | null): { left: number; top: number } {
  if (!container || typeof window === "undefined") {
    return { left: 16, top: 16 }
  }

  const xtermElement = container.querySelector<HTMLElement>(".xterm")
  if (!xtermElement) {
    return { left: 16, top: 16 }
  }

  const style = window.getComputedStyle(xtermElement)
  const left = Number.parseFloat(style.paddingLeft)
  const top = Number.parseFloat(style.paddingTop)

  return {
    left: Number.isFinite(left) ? left : 16,
    top: Number.isFinite(top) ? top : 16,
  }
}

/**
 * 从终端获取当前输入行
 * @param terminal xterm.js 终端实例
 * @returns 当前行的文本内容
 */
export function getCurrentLine(terminal: Terminal): string {
  const buffer = terminal.buffer.active
  const cursorY = buffer.cursorY + buffer.baseY
  const line = buffer.getLine(cursorY)

  if (!line) return ""

  // 保留光标前的尾随空格，否则 `git ` / `cd ` 这类场景会被错误解析为上一 token。
  const rawText = line.translateToString(false)
  const visibleLength = Math.max(rawText.trimEnd().length, buffer.cursorX)
  const text = rawText.slice(0, visibleLength)

  return text
}

interface ExtractedCommand {
  promptText: string
  command: string
}

const HIGH_CONFIDENCE_PROMPT_BOUNDARY_CHARS = new Set(["$", "#", "%", "❯", "❮", "➜", "➤", "›"])
const LOW_CONFIDENCE_PROMPT_BOUNDARY_CHARS = new Set([">"])

function looksLikePromptText(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (trimmed.length <= 2) return true
  return /[@:~/\\)\]]/.test(trimmed) || /[❯❮➜➤›]/.test(trimmed)
}

function extractCommandPartsWithBoundaries(
  line: string,
  boundaryChars: Set<string>
): ExtractedCommand | null {
  for (let index = line.length - 1; index >= 0; index--) {
    const char = line[index]
    if (!boundaryChars.has(char)) continue

    const nextChar = index + 1 < line.length ? line[index + 1] : ""
    if (nextChar && !/\s/.test(nextChar)) continue

    let commandStart = index + 1
    while (commandStart < line.length && /\s/.test(line[commandStart])) {
      commandStart++
    }

    const promptText = line.slice(0, commandStart)
    if (!looksLikePromptText(promptText)) continue

    return {
      promptText,
      command: line.slice(commandStart),
    }
  }

  return null
}

function extractCommandParts(line: string): ExtractedCommand {
  const highConfidenceResult = extractCommandPartsWithBoundaries(
    line,
    HIGH_CONFIDENCE_PROMPT_BOUNDARY_CHARS
  )
  if (highConfidenceResult) {
    return highConfidenceResult
  }

  const lowConfidenceResult = extractCommandPartsWithBoundaries(
    line,
    LOW_CONFIDENCE_PROMPT_BOUNDARY_CHARS
  )
  if (lowConfidenceResult) {
    return lowConfidenceResult
  }

  return {
    promptText: "",
    command: line.trimStart(),
  }
}

/**
 * 从当前行提取命令输入(去除 prompt)
 * @param line 完整行文本
 * @returns 去除 prompt 后的命令
 */
export function extractCommand(line: string): string {
  return extractCommandParts(line).command
}

interface TokenSpan {
  text: string
  start: number
  end: number
}

function tokenizeCommandWithPositions(input: string): TokenSpan[] {
  const tokens: TokenSpan[] = []
  let current = ""
  let start = -1
  let inSingleQuote = false
  let inDoubleQuote = false
  let escaped = false

  for (let index = 0; index < input.length; index++) {
    const char = input[index]

    if (escaped) {
      if (start < 0) start = index
      current += char
      escaped = false
      continue
    }

    if (char === "\\") {
      if (start < 0) start = index
      current += char
      escaped = true
      continue
    }

    if (char === "'" && !inDoubleQuote) {
      if (start < 0) start = index
      current += char
      inSingleQuote = !inSingleQuote
      continue
    }

    if (char === '"' && !inSingleQuote) {
      if (start < 0) start = index
      current += char
      inDoubleQuote = !inDoubleQuote
      continue
    }

    if (/\s/.test(char) && !inSingleQuote && !inDoubleQuote) {
      if (start >= 0) {
        tokens.push({ text: current, start, end: index })
        current = ""
        start = -1
      }
      continue
    }

    if (start < 0) start = index
    current += char
  }

  if (start >= 0) {
    tokens.push({ text: current, start, end: input.length })
  }

  if (input.length > 0 && /\s$/.test(input)) {
    tokens.push({ text: "", start: input.length, end: input.length })
  }

  if (tokens.length === 0) {
    tokens.push({ text: "", start: 0, end: 0 })
  }

  return tokens
}

/**
 * 解析命令为补全上下文
 * @param terminal xterm.js 终端实例
 * @returns 补全上下文
 */
export interface ParseCompletionContextOptions {
  cwd?: string
  triggerKind?: CompletionTriggerKind
}

function createCompletionContext(
  command: string,
  cursorPosition: number,
  promptText: string,
  options: ParseCompletionContextOptions,
): CompletionContext {
  const clampedCursorPosition = Math.max(0, Math.min(cursorPosition, command.length))
  const tokenSpans = tokenizeCommandWithPositions(command)
  const tokens = tokenSpans.map((token) => token.text)

  let currentTokenIndex = 0
  for (let i = 0; i < tokenSpans.length; i++) {
    const token = tokenSpans[i]
    if (clampedCursorPosition >= token.start && clampedCursorPosition <= token.end) {
      currentTokenIndex = i
      break
    }
    if (clampedCursorPosition > token.end) {
      currentTokenIndex = i
    }
  }

  const currentToken = tokenSpans[currentTokenIndex]
  return {
    fullLine: command,
    promptText,
    cwd: options.cwd,
    triggerKind: options.triggerKind,
    cursorPosition: clampedCursorPosition,
    currentWord: currentToken?.text || "",
    currentWordStart: currentToken?.start ?? clampedCursorPosition,
    currentWordEnd: currentToken?.end ?? clampedCursorPosition,
    tokens,
    currentTokenIndex,
  }
}

export function parseCompletionContextFromCommand(
  command: string,
  cursorPosition: number = command.length,
  options: ParseCompletionContextOptions = {},
): CompletionContext {
  return createCompletionContext(command, cursorPosition, "", options)
}

export function parseCompletionContext(
  terminal: Terminal,
  options: ParseCompletionContextOptions = {}
): CompletionContext {
  const buffer = terminal.buffer.active
  const fullLine = getCurrentLine(terminal)
  const { command, promptText } = extractCommandParts(fullLine)

  // 获取光标在命令中的位置
  const cursorX = buffer.cursorX
  const promptLength = fullLine.length - command.length
  const cursorPosition = Math.max(0, cursorX - promptLength)

  return createCompletionContext(command, cursorPosition, promptText, options)
}

/**
 * 去除 token 外层引号，支持未闭合引号。
 */
export function stripOuterQuote(value: string): string {
  if (
    value.length >= 1 &&
    ((value.startsWith("'") && !value.endsWith("'")) ||
      (value.startsWith('"') && !value.endsWith('"')))
  ) {
    return value.slice(1)
  }

  if (
    value.length >= 2 &&
    ((value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"')))
  ) {
    return value.slice(1, -1)
  }

  return value
}

/**
 * 反解 shell token 内的反斜杠转义。
 */
export function unescapeShellToken(value: string): string {
  let result = ""
  let escaped = false

  for (const char of value) {
    if (escaped) {
      result += char
      escaped = false
      continue
    }

    if (char === "\\") {
      escaped = true
      continue
    }

    result += char
  }

  if (escaped) {
    result += "\\"
  }

  return result
}

export function getCommandNameFromToken(token: string): string {
  const normalized = stripOuterQuote(token)
  const slashIndex = normalized.lastIndexOf("/")
  return (slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized).toLowerCase()
}

export function isShellOptionToken(token: string): boolean {
  return token.startsWith("-") && token !== "-" && token !== "--"
}

export function isShellAssignmentToken(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)
}

/**
 * 计算光标在屏幕上的位置(用于定位补全弹窗)
 * @param terminal xterm.js 终端实例
 * @param container 终端容器，用于把相对坐标转换为视口坐标
 * @returns 光标的屏幕坐标和当前行区域
 */
export function getCursorScreenPosition(terminal: Terminal, container?: HTMLElement | null): {
  x: number
  y: number
  lineTop: number
  lineBottom: number
} {
  const buffer = terminal.buffer.active
  const cursorX = buffer.cursorX
  const cursorY = buffer.cursorY
  const containerRect = container?.getBoundingClientRect()

  const cursorElement = container?.querySelector<HTMLElement>(".xterm-cursor-layer .xterm-cursor")
  const cursorRect = cursorElement?.getBoundingClientRect()
  if (cursorRect && cursorRect.width > 0 && cursorRect.height > 0) {
    return {
      x: cursorRect.left,
      y: cursorRect.bottom,
      lineTop: cursorRect.top,
      lineBottom: cursorRect.bottom,
    }
  }

  const padding = getTerminalPadding(container)
  const toViewport = (point: { x: number; y: number; lineTop: number; lineBottom: number }) => {
    if (!containerRect) {
      return point
    }

    return {
      x: point.x + containerRect.left,
      y: point.y + containerRect.top,
      lineTop: point.lineTop + containerRect.top,
      lineBottom: point.lineBottom + containerRect.top,
    }
  }

  // 方案2: 通过DOM测量获取字符尺寸
  const xtermScreen = container?.querySelector<HTMLElement>(".xterm-screen")
  if (xtermScreen && terminal.cols > 0 && terminal.rows > 0) {
    const rect = xtermScreen.getBoundingClientRect()
    const renderWidth = rect.width
    const renderHeight = rect.height

    if (renderWidth > 0 && renderHeight > 0) {
      const charWidth = renderWidth / terminal.cols
      const lineHeight = renderHeight / terminal.rows
      const lineTop = rect.top + cursorY * lineHeight
      const lineBottom = lineTop + lineHeight

      return {
        x: rect.left + cursorX * charWidth,
        y: rect.top + (cursorY + 1) * lineHeight,
        lineTop,
        lineBottom,
      }
    }
  }

  // 方案3: 尝试使用内部API获取精确尺寸。部分渲染器下这里可能受缩放影响，
  // 因此只在真实光标和屏幕 DOM 尺寸不可用时作为兜底。
  const dimensions = (terminal as TerminalWithRenderDimensions)._core?._renderService?.dimensions
  if (dimensions?.css?.cell) {
    const lineHeight = dimensions.css.cell.height
    const lineTop = padding.top + cursorY * lineHeight
    const lineBottom = lineTop + lineHeight
    return toViewport({
      x: padding.left + cursorX * dimensions.css.cell.width,
      y: padding.top + (cursorY + 1) * lineHeight,
      lineTop,
      lineBottom,
    })
  }

  // 方案4: 最终降级 - 使用经验值
  // 基于常见终端字体大小(14px)的估算
  const charWidth = 8.4 // 14px字体的平均字符宽度
  const lineHeight = 20 // 14px字体的行高
  const lineTop = padding.top + cursorY * lineHeight
  const lineBottom = lineTop + lineHeight

  return toViewport({
    x: padding.left + cursorX * charWidth,
    y: padding.top + (cursorY + 1) * lineHeight,
    lineTop,
    lineBottom,
  })
}

/**
 * 应用补全到终端
 * @param terminal xterm.js 终端实例
 * @param completion 补全文本
 * @param deleteCount 需要删除的字符数
 * @param sendInput 发送真实输入的函数（通过 WebSocket）
 */
export function applyCompletion(
  terminal: Terminal,
  completion: string,
  deleteCount: number,
  sendInput: (data: string) => void,
  forwardDeleteCount = 0
): void {
  // 合并删除和补全为一次操作，避免竞态条件和视觉闪烁
  let combinedInput = ""

  if (forwardDeleteCount > 0) {
    combinedInput += "\x1b[3~".repeat(forwardDeleteCount)
  }

  // 添加删除字符（如果需要）
  if (deleteCount > 0) {
    // 使用 \x7f (DEL/Backspace) 发送真实的删除操作
    // 这会同时更新显示和输入缓冲区
    combinedInput += "\x7f".repeat(deleteCount)
  }

  // 添加补全文本
  // 这确保补全的内容进入输入缓冲区，可以被正常删除
  combinedInput += completion

  // 一次性发送合并后的输入，消除两次发送导致的延迟和闪烁
  if (combinedInput) {
    sendInput(combinedInput)
  }
}

/**
 * 去除 ANSI 转义序列
 * @param text 包含 ANSI 转义序列的文本
 * @returns 纯文本
 */
export function stripAnsi(text: string): string {
  const escapeChar = String.fromCharCode(27)
  return text.replace(new RegExp(`${escapeChar}\\[[0-9;?]*[ -/]*[@-~]`, "g"), "")
}

/**
 * 计算两个字符串的公共前缀
 * @param strings 字符串数组
 * @returns 公共前缀
 */
export function getCommonPrefix(strings: string[]): string {
  if (strings.length === 0) return ""
  if (strings.length === 1) return strings[0]

  let prefix = strings[0]

  for (let i = 1; i < strings.length; i++) {
    while (strings[i].indexOf(prefix) !== 0) {
      prefix = prefix.substring(0, prefix.length - 1)
      if (prefix === "") return ""
    }
  }

  return prefix
}

/**
 * 检查是否是 Tab 键
 * @param data 终端输入数据
 * @returns 是否是 Tab 键
 */
export function isTabKey(data: string): boolean {
  return data === "\t"
}

/**
 * 检查是否是 Escape 键
 * @param data 终端输入数据
 * @returns 是否是 Escape 键
 */
export function isEscapeKey(data: string): boolean {
  return data === "\x1b"
}

/**
 * 检查是否是上箭头键
 * @param data 终端输入数据
 * @returns 是否是上箭头键
 */
export function isUpArrow(data: string): boolean {
  return data === "\x1b[A"
}

/**
 * 检查是否是下箭头键
 * @param data 终端输入数据
 * @returns 是否是下箭头键
 */
export function isDownArrow(data: string): boolean {
  return data === "\x1b[B"
}

/**
 * 检查是否是回车键
 * @param data 终端输入数据
 * @returns 是否是回车键
 */
export function isEnterKey(data: string): boolean {
  return data === "\r" || data === "\n"
}

/**
 * 检查是否是 Backspace 键
 * @param data 终端输入数据
 * @returns 是否是 Backspace 键
 */
export function isBackspaceKey(data: string): boolean {
  return data === "\x7f" || data === "\b"
}

/**
 * 命令匹配辅助:
 * - 优先按整行前缀前缀匹配: command.startsWith(linePrefix)
 * - 如果整行不匹配, 按“按空格分词 + 最后一个词前缀匹配”的方式匹配:
 *   例如: linePrefix = "docker sy", command = "docker system prune -af"
 *   => tokensPrefix = ["docker", "sy"], tokensCmd = ["docker", "system", "prune", "-af"]
 *   => 前面的 token 要完全相等, 最后一个 token 允许前缀匹配
 */
export function matchesCommandWithPrefix(
  command: string,
  linePrefix: string,
  currentWord: string
): boolean {
  const cleanedLinePrefix = linePrefix.trim()
  const effectivePrefix =
    cleanedLinePrefix || (currentWord ? currentWord.trim() : "")

  if (!effectivePrefix) return false

  const cmdLower = command.toLowerCase()
  const linePrefixLower = cleanedLinePrefix.toLowerCase()
  const currentWordLower = currentWord.toLowerCase()

  // 1. 整行前缀匹配
  if (cleanedLinePrefix && cmdLower.startsWith(linePrefixLower)) {
    return true
  }

  // 2. 按 token 匹配:
  //    - 前面的 token 必须完全相等
  //    - 最后一个 token 允许前缀匹配 (用户正在输入的那个词)
  const prefixTokens = (cleanedLinePrefix || currentWordLower)
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => t.toLowerCase())

  const cmdTokens = command
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => t.toLowerCase())

  if (prefixTokens.length === 0 || cmdTokens.length === 0) {
    return false
  }

  for (let i = 0; i < prefixTokens.length; i++) {
    const p = prefixTokens[i]
    const c = cmdTokens[i]
    if (!c) return false

    const isLast = i === prefixTokens.length - 1

    if (isLast) {
      // 最后一个词允许前缀匹配
      if (!c.startsWith(p)) return false
    } else {
      // 之前的词必须完全匹配
      if (c !== p) return false
    }
  }

  return true
}
