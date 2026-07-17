import {
  openapiClient,
  requireOpenAPIData,
  throwOpenAPIError,
} from "@/lib/openapi-client"
import type { components } from "@/types/openapi"

export type PermissionModule = components["schemas"]["PermissionModule"]
export type Permission = components["schemas"]["Permission"]
export type Role = components["schemas"]["Role"]
export type RoleRequest = components["schemas"]["RoleRequest"]
export type ResourceGrant = components["schemas"]["ResourceGrant"]
export type ResourceGrantRequest = components["schemas"]["ResourceGrantRequest"]

export const permissionsApi = {
  async list(params?: { module?: PermissionModule; q?: string }) {
    const { data, error, response } = await openapiClient.GET("/permissions", {
      params: { query: params },
    })
    if (error) throwOpenAPIError(error, response)
    return requireOpenAPIData(data, response)
  },
}

export const rolesApi = {
  async list() {
    const { data, error, response } = await openapiClient.GET("/roles")
    if (error) throwOpenAPIError(error, response)
    return requireOpenAPIData(data, response)
  },

  async create(body: RoleRequest) {
    const { data, error, response } = await openapiClient.POST("/roles", { body })
    if (error) throwOpenAPIError(error, response)
    return requireOpenAPIData(data, response)
  },

  async update(id: string, body: RoleRequest) {
    const { data, error, response } = await openapiClient.PUT("/roles/{id}", {
      params: { path: { id } },
      body,
    })
    if (error) throwOpenAPIError(error, response)
    return requireOpenAPIData(data, response)
  },

  async delete(id: string) {
    const { data, error, response } = await openapiClient.DELETE("/roles/{id}", {
      params: { path: { id } },
    })
    if (error) throwOpenAPIError(error, response)
    return requireOpenAPIData(data, response)
  },
}

export const resourceGrantsApi = {
  async list(subjectType: "user" | "role", subjectId: string) {
    const { data, error, response } = await openapiClient.GET("/resource-grants", {
      params: { query: { subject_type: subjectType, subject_id: subjectId } },
    })
    if (error) throwOpenAPIError(error, response)
    return requireOpenAPIData(data, response)
  },

  async grant(body: ResourceGrantRequest) {
    const { data, error, response } = await openapiClient.POST("/resource-grants", { body })
    if (error) throwOpenAPIError(error, response)
    return requireOpenAPIData(data, response)
  },

  async revoke(body: ResourceGrantRequest) {
    const { data, error, response } = await openapiClient.POST("/resource-grants/revoke", { body })
    if (error) throwOpenAPIError(error, response)
    return requireOpenAPIData(data, response)
  },
}
