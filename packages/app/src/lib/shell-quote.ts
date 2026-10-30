/**
 * 将单个字符串安全地编码为 POSIX shell 参数。
 * 终端联动只能通过这个边界构造路径参数，避免空格和 shell 元字符改变命令语义。
 */
export function quoteShellArgument(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) {
    return value
  }

  return `'${value.replace(/'/g, `'"'"'`)}'`
}
