import { useQuery } from "@tanstack/react-query"

import { useAuthReady } from "@/hooks/use-auth-ready"
import {
  userAdministrationQueryOptions,
} from "@/lib/dashboard-query-options"

export type { UserAdministrationData } from "@/lib/dashboard-query-options"

export function useUserAdministration() {
  const { ready } = useAuthReady()

  return useQuery({
    ...userAdministrationQueryOptions(),
    enabled: ready,
  })
}
