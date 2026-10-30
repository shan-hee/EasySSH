/** The active host resolves a task inside its own workspace. IDs never choose an origin. */
export function openWorkspaceTask(id: string) {
  window.dispatchEvent(new CustomEvent("easyssh:open-task", { detail: { id } }))
}
