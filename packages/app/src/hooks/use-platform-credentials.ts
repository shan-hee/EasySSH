import { useSyncExternalStore } from "react"
import { getOptionalPlatformTransport } from "@/contracts/platform-transport"

const subscribeNothing = () => () => undefined

/** 宿主是否持有可用凭据；未注入平台传输（例如桌面本地工作区）时为 false。 */
export function usePlatformCredentials(): boolean {
  const transport = getOptionalPlatformTransport()
  return useSyncExternalStore(
    transport ? transport.subscribeCredentials : subscribeNothing,
    () => transport?.hasCredentials() ?? false,
  )
}
