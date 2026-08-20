import { useTranslation } from "react-i18next"
import { PageHeader } from "@/components/page-header"
import { UserManagementContent } from "./settings/management/_tabs/user-management-content"

export default function ManagementPage() {
  const { t } = useTranslation("settingsManagement")
  return (
    <>
      <PageHeader title={t("pageTitle")} />
      <UserManagementContent />
    </>
  )
}
