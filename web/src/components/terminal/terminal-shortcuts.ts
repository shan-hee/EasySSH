export const TERMINAL_SHORTCUT_KEYS = [
  "copyShortcut",
  "pasteShortcut",
  "clearShortcut",
  "findShortcut",
  "zoomInShortcut",
  "zoomOutShortcut",
  "zoomResetShortcut",
] as const

export type TerminalShortcutKey = (typeof TERMINAL_SHORTCUT_KEYS)[number]

const modifiers = ["Ctrl", "Alt", "Shift", "Meta"] as const
const modifierKeys = new Set(["Control", "Alt", "Shift", "Meta", "AltGraph"])

export function shortcutFromEvent(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">,
): string | null {
  if (modifierKeys.has(event.key)) return null
  if (!event.ctrlKey && !event.altKey && !event.metaKey) return null
  const parts = modifiers.filter(
    (modifier) =>
      ({ Ctrl: event.ctrlKey, Alt: event.altKey, Shift: event.shiftKey, Meta: event.metaKey })[
        modifier
      ],
  )
  const key =
    event.key === " "
      ? "Space"
      : event.key === "+"
        ? "Plus"
        : event.key.length === 1
          ? event.key.toUpperCase()
          : event.key
  return [...parts, key].join("+")
}

export function normalizeShortcut(value: string): string | null {
  if (!value) return ""
  const parts = value.split("+")
  const key = parts.pop() ?? ""
  if (!key || modifierKeys.has(key) || modifiers.some((modifier) => modifier === key)) return null
  if (!parts.some((part) => part === "Ctrl" || part === "Alt" || part === "Meta")) return null
  if (
    new Set(parts).size !== parts.length ||
    parts.some((part) => !modifiers.some((modifier) => modifier === part))
  )
    return null
  if (
    !(
      key.length === 1 ||
      /^(Space|Plus|Arrow(Up|Down|Left|Right)|F([1-9]|1[0-9]|2[0-4])|Home|End|PageUp|PageDown|Insert|Delete|Backspace|Tab|Enter|Escape)$/.test(
        key,
      )
    )
  )
    return null
  return [
    ...modifiers.filter((modifier) => parts.includes(modifier)),
    key.length === 1 ? key.toUpperCase() : key,
  ].join("+")
}

export function matchesTerminalShortcut(event: KeyboardEvent, shortcut: string): boolean {
  return !!shortcut && shortcutFromEvent(event) === shortcut
}
