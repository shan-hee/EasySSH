
import { type QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useEffect, useState, type ReactNode } from "react"
import { createQueryClient } from "@/lib/query-client"

export function QueryProvider({ children, client }: { children: ReactNode; client?: QueryClient }) {
  const [queryClient] = useState(() => client ?? createQueryClient())

  useEffect(() => {
    const refresh = () => { void queryClient.invalidateQueries() }
    window.addEventListener("easyssh:sync-applied", refresh)
    return () => window.removeEventListener("easyssh:sync-applied", refresh)
  }, [queryClient])

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
