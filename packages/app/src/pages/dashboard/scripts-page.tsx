import ScriptsPage, { type ScriptsPageAdapters } from "@/components/dashboard/scripts/scripts-page"
import { batchTasksApi, scriptsApi, serversApi } from "@/lib/api"

const adapters: ScriptsPageAdapters = {
  scripts: scriptsApi,
  servers: serversApi,
  batchTasks: batchTasksApi,
}

export default function ScriptsRoutePage() {
  return <ScriptsPage adapters={adapters} />
}
