import { useQuery } from "@tanstack/react-query"

import { useAuthReady } from "@/hooks/use-auth-ready"
import {
  permissionsApi,
  rolesApi,
  usersApi,
  type Permission,
  type Role,
  type UserDetail,
  type UserStatistics,
} from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"

export interface UserAdministrationData {
  users: UserDetail[]
  roles: Role[]
  permissions: Permission[]
  statistics: UserStatistics
}

export function useUserAdministration() {
  const { ready } = useAuthReady()

  return useQuery({
    queryKey: queryKeys.users.administration,
    queryFn: async (): Promise<UserAdministrationData> => {
      const [userResponse, roleResponse, permissionResponse, statistics] = await Promise.all([
        usersApi.list({ page: 1, limit: 100 }),
        rolesApi.list(),
        permissionsApi.list(),
        usersApi.getStatistics(),
      ])

      return {
        users: Array.isArray(userResponse.data) ? userResponse.data : [],
        roles: Array.isArray(roleResponse.data) ? roleResponse.data : [],
        permissions: Array.isArray(permissionResponse.data) ? permissionResponse.data : [],
        statistics,
      }
    },
    enabled: ready,
  })
}
