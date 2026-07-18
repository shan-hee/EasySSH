
import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { getErrorMessage } from "@/lib/error-utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Plus,
  Users,
  Shield,
  Trash2,
} from "lucide-react"
import { rolesApi, usersApi, type Role, type UserDetail, type UserRole } from "@/lib/api"
import { SkeletonCard } from "@/components/ui/loading"
import { DataTable } from "@/components/ui/data-table"
import { DataTableToolbar } from "@/components/ui/data-table-toolbar"
import { useUserColumns } from "@/pages/dashboard/users/components/user-columns"
import { useAuthReady } from "@/hooks/use-auth-ready"
import { useConfirmDialog } from "@/hooks/use-confirm-dialog"
import { useTranslation } from "react-i18next"

// 提取自 /dashboard/users/page.tsx 的用户管理内容
// 去掉了 PageHeader，作为 Tab 内容使用
export function UserManagementContent() {
  const { t } = useTranslation("users")
  const { ready } = useAuthReady()
  const { confirm: requestConfirm, confirmDialog } = useConfirmDialog()
  // 数据状态
  const [users, setUsers] = useState<UserDetail[]>([])
	const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  const [, setRefreshing] = useState(false)

  // 统计状态
  const [statistics, setStatistics] = useState({
    totalUsers: 0,
    byRole: {} as Record<string, number>,
  })

  // 对话框状态
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false)
  const [editingUserId, setEditingUserId] = useState<string | null>(null)
  const [passwordUserId, setPasswordUserId] = useState<string | null>(null)

  // 新建用户表单
  const [newUser, setNewUser] = useState({
    username: "",
    email: "",
    password: "",
    role: "user" as UserRole,
  })

  // 编辑用户表单
  const [editUser, setEditUser] = useState({
    username: "",
    email: "",
    role: "user" as UserRole,
  })

  // 修改密码表单
  const [newPassword, setNewPassword] = useState("")

  // 加载用户列表
  const loadUsers = useCallback(async () => {
    try {
      const [usersRes, statsRes, rolesRes] = await Promise.all([
        usersApi.list({ page: 1, limit: 100 }),
        usersApi.getStatistics(),
			rolesApi.list(),
      ])

      const usersList = Array.isArray(usersRes)
        ? usersRes
        : (Array.isArray(usersRes?.data) ? usersRes.data : [])
      const statsData = statsRes

      setUsers(usersList)
			setRoles(Array.isArray(rolesRes.data) ? rolesRes.data : [])
      setStatistics({
        totalUsers: statsData.total_users || 0,
        byRole: statsData.by_role || {},
      })
    } catch (error: unknown) {
      console.error("加载用户列表失败:", error)
      setUsers([])
      toast.error(getErrorMessage(error, t("toastLoadFailed")))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [t])

  // 刷新数据
  const handleRefresh = async () => {
    setRefreshing(true)
    await loadUsers()
  }

  // 初始加载（仅在已认证且全局状态就绪时触发）
  useEffect(() => {
    if (!ready) return
    loadUsers()
  }, [ready, loadUsers])

  // 创建用户
  const handleCreateUser = async () => {
    if (!newUser.username || !newUser.email || !newUser.password) {
      toast.error(t("toastFormIncomplete"))
      return
    }

    try {
      await usersApi.create(newUser)
      toast.success(t("toastCreateSuccess"))
      setIsCreateDialogOpen(false)
      setNewUser({ username: "", email: "", password: "", role: "user" })
      await loadUsers()
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("toastCreateFailed")))
    }
  }

  // 打开编辑对话框
  const handleOpenEditDialog = (user: UserDetail) => {
    setEditingUserId(user.id)
    setEditUser({
      username: user.username,
      email: user.email,
      role: user.role,
    })
    setIsEditDialogOpen(true)
  }

  // 更新用户
  const handleUpdateUser = async () => {
    if (!editingUserId) return
    if (!editUser.username || !editUser.email) {
      toast.error(t("toastFormIncomplete"))
      return
    }

    try {
      await usersApi.update(editingUserId, editUser)
      toast.success(t("toastUpdateSuccess"))
      setIsEditDialogOpen(false)
      setEditingUserId(null)
      await loadUsers()
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("toastUpdateFailed")))
    }
  }

  // 打开修改密码对话框
  const handleOpenPasswordDialog = (userId: string) => {
    setPasswordUserId(userId)
    setNewPassword("")
    setIsPasswordDialogOpen(true)
  }

  // 修改密码
  const handleChangePassword = async () => {
    if (!passwordUserId) return
    if (!newPassword || newPassword.length < 6) {
      toast.error(t("toastPasswordTooShort"))
      return
    }

    try {
      await usersApi.changePassword(passwordUserId, { new_password: newPassword })
      toast.success(t("toastPasswordChangeSuccess"))
      setIsPasswordDialogOpen(false)
      setPasswordUserId(null)
      setNewPassword("")
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("toastPasswordChangeFailed")))
    }
  }

  // 删除用户
  const handleDeleteUser = async (userId: string, username: string) => {
    const confirmed = await requestConfirm({
      description: t("confirmDeleteSingle", { username }),
      variant: "destructive",
    })
    if (!confirmed) {
      return
    }

    try {
      await usersApi.delete(userId)
      toast.success(t("toastDeleteSuccess"))
      await loadUsers()
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("toastDeleteFailed")))
    }
  }

  // 批量删除
  const handleBatchDelete = async (userIds: string[]) => {
    const confirmed = await requestConfirm({
      description: t("confirmDeleteBatch", { count: userIds.length }),
      variant: "destructive",
    })
    if (!confirmed) {
      return
    }

    try {
      await Promise.all(
        userIds.map((id) => usersApi.delete(id))
      )
      toast.success(t("toastBatchDeleteSuccess", { count: userIds.length }))
      await loadUsers()
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t("toastDeleteFailed")))
    }
  }

  // 表格列定义
  const columns = useUserColumns({
    onEdit: handleOpenEditDialog,
    onChangePassword: handleOpenPasswordDialog,
    onDelete: handleDeleteUser,
  })

  // 渲染主体内容（去掉 PageHeader）
  return loading ? (
    <div className="flex min-w-0 flex-1 flex-col gap-3 p-3 pt-0 sm:gap-4 sm:p-4 sm:pt-0">
      {/* 统计概览骨架屏 */}
      <div className="grid shrink-0 gap-2 md:grid-cols-4">
        <SkeletonCard showHeader={false} lines={2} />
        <SkeletonCard showHeader={false} lines={2} />
        <SkeletonCard showHeader={false} lines={2} />
        <SkeletonCard showHeader={false} lines={2} />
      </div>
      {/* 表格骨架屏 */}
      <SkeletonCard showHeader lines={8} className="min-h-[520px] flex-1" />
    </div>
  ) : (
    <div className="flex min-w-0 flex-1 flex-col gap-3 p-3 pt-0 sm:gap-4 sm:p-4 sm:pt-0">
      {confirmDialog}
      <div className="grid shrink-0 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: t("statsTotalUsers"), value: statistics.totalUsers, icon: Users, hint: t("statsTotalUsersDesc") },
          ...roles.map((role) => ({
            label: role.name,
            value: statistics.byRole[role.key] || 0,
            icon: Shield,
            hint: role.description,
          })),
        ].map((item) => {
          const Icon = item.icon
          return (
            <div key={item.label} className="rounded-md border bg-card p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-xs text-muted-foreground">{item.label}</div>
                  <div className="mt-1 text-xl font-semibold tabular-nums">{item.value}</div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">{item.hint}</div>
                </div>
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex shrink-0 flex-col gap-1 rounded-md border bg-card p-4 sm:p-5">
        <h2 className="text-base font-semibold">{t("pageTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("tableDescription", { count: users.length })}</p>
      </div>

      {/* 用户管理表格 */}
      <div className="min-h-[520px] flex-1">
        <DataTable
          columns={columns}
          data={users}
          enableRowSelection={true}
          className="min-h-[520px]"
          scrollContainerClassName="min-h-[360px]"
          toolbar={(table) => (
            <DataTableToolbar
              table={table}
              searchKey="username"
              searchPlaceholder={t("searchPlaceholder")}
              filters={[
                {
                  column: "role",
                  title: t("filterRoleTitle"),
                  options: [
                    ...roles.map((role) => ({ label: role.name, value: role.key, icon: Shield })),
                  ],
                },
              ]}
              onRefresh={handleRefresh}
              showRefresh={true}
            >
              <Button size="sm" onClick={() => setIsCreateDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                {t("btnNewUser")}
              </Button>
            </DataTableToolbar>
          )}
          batchActions={(table) => (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                const selectedRows = table.getFilteredSelectedRowModel().rows
                const userIds = selectedRows.map((row) => (row.original as UserDetail).id)
                handleBatchDelete(userIds)
              }}
              className="h-7"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {t("batchDelete")}
            </Button>
          )}
        />
      </div>

      {/* 创建用户对话框 */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dialogCreateTitle")}</DialogTitle>
            <DialogDescription>{t("dialogCreateDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="create-username">
                {t("fieldUsername")} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="create-username"
                value={newUser.username}
                onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                placeholder={t("placeholderUsername")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-email">
                {t("fieldEmail")} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="create-email"
                type="email"
                value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                placeholder={t("placeholderEmail")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-password">
                {t("fieldPassword")} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="create-password"
                type="password"
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                placeholder={t("placeholderPassword")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-role">
                {t("fieldRole")} <span className="text-destructive">*</span>
              </Label>
              <Select
                value={newUser.role}
                onValueChange={(value: UserRole) => setNewUser({ ...newUser, role: value })}
              >
                <SelectTrigger id="create-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
						{roles.map((role) => <SelectItem key={role.key} value={role.key}>{role.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
              {t("dialogCancel")}
            </Button>
            <Button onClick={handleCreateUser}>{t("dialogCreateSubmit")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 编辑用户对话框 */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dialogEditTitle")}</DialogTitle>
            <DialogDescription>{t("dialogEditDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-username">
                {t("fieldUsername")} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="edit-username"
                value={editUser.username}
                onChange={(e) => setEditUser({ ...editUser, username: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-email">
                {t("fieldEmail")} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="edit-email"
                type="email"
                value={editUser.email}
                onChange={(e) => setEditUser({ ...editUser, email: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-role">
                {t("fieldRole")} <span className="text-destructive">*</span>
              </Label>
              <Select
                value={editUser.role}
                onValueChange={(value: UserRole) => setEditUser({ ...editUser, role: value })}
              >
                <SelectTrigger id="edit-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
						{roles.map((role) => <SelectItem key={role.key} value={role.key}>{role.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              {t("dialogCancel")}
            </Button>
            <Button onClick={handleUpdateUser}>{t("dialogEditSubmit")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 修改密码对话框 */}
      <Dialog open={isPasswordDialogOpen} onOpenChange={setIsPasswordDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dialogPasswordTitle")}</DialogTitle>
            <DialogDescription>{t("dialogPasswordDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">
                {t("fieldNewPassword")} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t("placeholderNewPassword")}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPasswordDialogOpen(false)}>
              {t("dialogCancel")}
            </Button>
            <Button onClick={handleChangePassword}>{t("dialogPasswordSubmit")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
