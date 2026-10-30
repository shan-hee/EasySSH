export interface Script {
  id: string
  /** 语言与正文的版本摘要，执行时用于确认脚本未被修改。 */
  version: string
  name: string
  description: string
  content: string
  language: string
  tags: string[]
  executions: number
  author: string
  created_at: string
  updated_at: string
}

export interface CreateScriptRequest {
  name: string
  description?: string
  content: string
  language?: string
  tags?: string[]
}

export interface UpdateScriptRequest {
  name?: string
  description?: string
  content?: string
  language?: string
  tags?: string[]
}

export interface ListScriptsParams {
  page?: number
  limit?: number
  search?: string
  tags?: string[]
  language?: string
}

export interface ListScriptsResponse {
  data: Script[]
  total: number
  page: number
  page_size: number
  total_pages: number
}
