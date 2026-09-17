// Match at the caret without requiring a space before @, including in Chinese
// sentences. Whitespace after the query closes the picker after insertion.
export function matchServerMentionTrigger(text: string, triggerChar: string, cursorPosition: number) {
  const beforeCursor = text.slice(0, cursorPosition)
  const offset = beforeCursor.lastIndexOf(triggerChar)
  if (offset < 0) return null

  const query = beforeCursor.slice(offset + triggerChar.length)
  if (/\s/u.test(query)) return null

  return { query, offset, endOffset: cursorPosition }
}

export function hasServerMention(text: string, displayName: string) {
  const mention = `@${displayName}`
  let offset = text.indexOf(mention)
  while (offset >= 0) {
    const end = offset + mention.length
    // Compare names literally: dots, brackets and other regex characters are
    // valid server names. Require a boundary to avoid matching name prefixes.
    if (end === text.length || /[\s,，。.!?;；:：、)\]）】]/u.test(text[end])) return true
    offset = text.indexOf(mention, offset + mention.length)
  }
  return false
}
