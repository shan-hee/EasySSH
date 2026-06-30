
import { useState } from "react"
import { PageHeader } from "@/components/page-header"
import { Users, Database } from "lucide-react"
import { UserManagementContent } from "./settings/management/_tabs/user-management-content"
import { BackupRestoreTab } from "./settings/management/_tabs/backup-restore-tab"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useTranslation } from "react-i18next"

type SectionId = "users" | "backup"

export default function ManagementPage() {
  const { t } = useTranslation("settingsManagement")
  const [activeSection, setActiveSection] = useState<SectionId>("users")

  const navItems: { id: SectionId; icon: typeof Users; labelKey: "navUsers" | "navBackup" }[] = [
    { id: "users", icon: Users, labelKey: "navUsers" },
    { id: "backup", icon: Database, labelKey: "navBackup" },
  ]

  const handleSectionChange = (section: SectionId) => {
    setActiveSection(section)
  }

  return (
    <>
      <PageHeader title={t("pageTitle")} />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden p-3 pt-0 scrollbar-custom sm:p-4 sm:pt-0">
        <Tabs
          value={activeSection}
          onValueChange={(value) => handleSectionChange(value as SectionId)}
          className="min-h-0 flex-1 gap-3"
        >
          <div className="flex shrink-0 flex-col gap-3 rounded-md border bg-card p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div>
              <h2 className="text-base font-semibold">{t("pageTitle")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">集中维护组织成员、权限策略与系统备份。</p>
            </div>
            <TabsList className="w-full sm:w-fit">
              {navItems.map((item) => (
                <TabsTrigger key={item.id} value={item.id} className="gap-2">
                  <item.icon className="h-4 w-4" />
                  {t(item.labelKey)}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <TabsContent value="users" className="mt-0 flex min-h-[620px] shrink-0 overflow-hidden xl:min-h-0 xl:flex-1">
            <UserManagementContent />
          </TabsContent>
          <TabsContent value="backup" className="mt-0 min-h-0 overflow-auto scrollbar-custom">
            <BackupRestoreTab />
          </TabsContent>
        </Tabs>
      </div>
    </>
  )
}
