import createClient from "openapi-fetch"

import { getApiUrl, openapiTransportFetch, type ApiError } from "@/lib/api-client"
import { resolveAPIErrorMessage } from "@/lib/api-error"
import type { paths } from "@/types/openapi"

/** 唯一 JSON API 客户端；路径、参数、请求体和响应均由 OpenAPI 推导。 */
export const openapiClient = createClient<paths>({
  baseUrl: getApiUrl(),
  fetch: openapiTransportFetch,
})

/** 将 openapi-fetch 的显式错误分支转换为项目统一异常。 */
export function throwOpenAPIError(error: unknown, response: Response): never {
  const fallbackMessage = `API ${response.status} ${response.statusText}`
  throw Object.assign(
    new Error(resolveAPIErrorMessage(error, fallbackMessage)),
    { status: response.status, detail: error },
  ) satisfies ApiError
}

export function requireOpenAPIData<T>(data: T | undefined, response: Response): T {
  if (data !== undefined) return data
  throw Object.assign(new Error("API response body is missing"), {
    status: response.status,
    detail: null,
  }) satisfies ApiError
}
