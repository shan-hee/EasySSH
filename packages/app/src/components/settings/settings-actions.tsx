import { createContext, useCallback, useContext, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { SettingsFormActions } from "./settings-form-actions"

export interface SettingsFormEntry {
  dirty: boolean
  saving: boolean
  save: () => Promise<boolean>
  reset: () => void
}

type Register = (id: string, entry: SettingsFormEntry | null) => void

const RegisterContext = createContext<Register | null>(null)
const EntriesContext = createContext<Record<string, SettingsFormEntry>>({})

/**
 * Every settings form inside registers here, so a section shows a single
 * save/reset pair in its header no matter how many forms it is built from.
 */
export function SettingsActionsProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Record<string, SettingsFormEntry>>({})
  const register = useCallback<Register>((id, entry) => setEntries(current => {
    if (entry) return { ...current, [id]: entry }
    if (!(id in current)) return current
    const next = { ...current }
    delete next[id]
    return next
  }), [])
  return <RegisterContext.Provider value={register}>
    <EntriesContext.Provider value={entries}>{children}</EntriesContext.Provider>
  </RegisterContext.Provider>
}

export function useSettingsActionsRegister() {
  return useContext(RegisterContext)
}

export function SettingsHeaderActions() {
  const { t } = useTranslation("settingsCommon")
  const entries = Object.values(useContext(EntriesContext))
  const dirty = entries.filter(entry => entry.dirty)
  return <SettingsFormActions
    visible={dirty.length > 0}
    isSaving={entries.some(entry => entry.saving)}
    onReset={() => dirty.forEach(entry => entry.reset())}
    onSave={async () => {
      const results = await Promise.all(dirty.map(entry => entry.save()))
      if (results.every(Boolean)) toast.success(t("toastSaveSuccess"))
    }}
  />
}
