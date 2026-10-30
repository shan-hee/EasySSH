/**
 * 交给浏览器原生下载。地址需自带一次性票据等凭据，响应由服务端以附件形式返回，
 * 不经过内存缓冲，适合大文件。
 */
export function startBrowserDownload(url: string, fileName?: string): void {
  const link = document.createElement("a")
  link.href = url
  if (fileName) link.download = fileName
  link.rel = "noopener noreferrer"
  document.body.appendChild(link)
  link.click()
  link.remove()
}
