import { Loader2, RotateCcw, Save } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"

interface SettingsFormActionsProps {
  visible: boolean
  isSaving: boolean
  onReset: () => void
  onSave: () => void | Promise<void>
}

export function SettingsFormActions({
  visible,
  isSaving,
  onReset,
  onSave,
}: SettingsFormActionsProps) {
  const { t } = useTranslation("common")

  if (!visible) return null

  return (
    <div className="flex items-center gap-2">
      <Button type="button" size="sm" variant="outline" onClick={onReset} disabled={isSaving}>
        <RotateCcw className="mr-2 h-4 w-4" />
        {t("reset")}
      </Button>
      <Button type="button" size="sm" onClick={() => void onSave()} disabled={isSaving}>
        {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
        {isSaving ? t("saving") : t("save")}
      </Button>
    </div>
  )
}
