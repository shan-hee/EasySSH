import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Edit, KeyRound, Lock, Plus, RefreshCw, Shield, Trash2, Unlock, Users } from "lucide-react"
import { toast } from "sonner"

import { PageHeader } from "@/components/page-header"
import { DataTable } from "@/components/ui/data-table"
import { DataTableToolbar } from "@/components/ui/data-table-toolbar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { useAuthReady } from "@/hooks/use-auth-ready"
import { useConfirmDialog } from "@/hooks/use-confirm-dialog"
import {
  permissionsApi,
  resourceGrantsApi,
  rolesApi,
  usersApi,
  type Permission,
  type ResourceGrant,
  type Role,
  type RoleRequest,
  type UserDetail,
  type UserRole,
} from "@/lib/api"
import { getErrorMessage } from "@/lib/error-utils"
import { usePermissionColumns } from "./users/components/permission-columns"
import { useUserColumns } from "./users/components/user-columns"

type UserForm = { username: string; email: string; password: string; role: UserRole }
type RoleForm = { key: string; name: string; description: string; parent_key: string; permission_codes: string[] }

const emptyUserForm: UserForm = { username: "", email: "", password: "", role: "user" }
const emptyRoleForm: RoleForm = { key: "", name: "", description: "", parent_key: "", permission_codes: [] }

export default function UsersPage() {
  const { t } = useTranslation("users")
  const { t: tCommon } = useTranslation("common")
  const { ready } = useAuthReady()
  const { confirm: requestConfirm, confirmDialog } = useConfirmDialog()

  const [users, setUsers] = useState<UserDetail[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const [userDialog, setUserDialog] = useState<"create" | "edit" | null>(null)
  const [editingUserID, setEditingUserID] = useState("")
  const [userForm, setUserForm] = useState<UserForm>(emptyUserForm)
  const [passwordUserID, setPasswordUserID] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [lockTarget, setLockTarget] = useState<{ id: string; username: string } | null>(null)
  const [lockReason, setLockReason] = useState("")
  const [lockMinutes, setLockMinutes] = useState("60")

  const [roleDialog, setRoleDialog] = useState<"create" | "edit" | null>(null)
  const [editingRoleID, setEditingRoleID] = useState("")
  const [roleForm, setRoleForm] = useState<RoleForm>(emptyRoleForm)

  const [grantSubjectType, setGrantSubjectType] = useState<"role" | "user">("role")
  const [grantSubjectID, setGrantSubjectID] = useState("")
  const [grantPermissionCode, setGrantPermissionCode] = useState("")
  const [grantResourceID, setGrantResourceID] = useState("")
  const [resourceGrants, setResourceGrants] = useState<ResourceGrant[]>([])

  const loadData = useCallback(async () => {
    try {
      const [userResponse, roleResponse, permissionResponse] = await Promise.all([
        usersApi.list({ page: 1, limit: 100 }),
        rolesApi.list(),
        permissionsApi.list(),
      ])
      setUsers(Array.isArray(userResponse.data) ? userResponse.data : [])
      setRoles(Array.isArray(roleResponse.data) ? roleResponse.data : [])
      setPermissions(Array.isArray(permissionResponse.data) ? permissionResponse.data : [])
    } catch (error) {
      toast.error(getErrorMessage(error, t("toastLoadFailed")))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [t])

  useEffect(() => {
    if (ready) void loadData()
  }, [ready, loadData])

  useEffect(() => {
    if (!grantSubjectID) {
      setResourceGrants([])
      return
    }
    void resourceGrantsApi
      .list(grantSubjectType, grantSubjectID)
      .then((response) => setResourceGrants(response.data || []))
      .catch((error) => toast.error(getErrorMessage(error, t("rbacGrantLoadFailed"))))
  }, [grantSubjectID, grantSubjectType, t])

  const refresh = () => {
    setRefreshing(true)
    void loadData()
  }

  const openCreateUser = () => {
    setEditingUserID("")
    setUserForm({ ...emptyUserForm, role: roles.find((role) => role.key === "user")?.key || roles[0]?.key || "" })
    setUserDialog("create")
  }

  const openEditUser = (user: UserDetail) => {
    setEditingUserID(user.id)
    setUserForm({ username: user.username, email: user.email, password: "", role: user.role })
    setUserDialog("edit")
  }

  const saveUser = async () => {
    if (!userForm.username || !userForm.email || !userForm.role || (userDialog === "create" && !userForm.password)) {
      toast.error(t("toastFormIncomplete"))
      return
    }
    try {
      if (userDialog === "create") {
        await usersApi.create(userForm)
        toast.success(t("toastCreateSuccess"))
      } else {
        await usersApi.update(editingUserID, { username: userForm.username, email: userForm.email, role: userForm.role })
        toast.success(t("toastUpdateSuccess"))
      }
      setUserDialog(null)
      await loadData()
    } catch (error) {
      toast.error(getErrorMessage(error, userDialog === "create" ? t("toastCreateFailed") : t("toastUpdateFailed")))
    }
  }

  const deleteUser = async (id: string, username: string) => {
    if (!(await requestConfirm({ description: t("confirmDeleteSingle", { username }), variant: "destructive" }))) return
    try {
      await usersApi.delete(id)
      toast.success(t("toastDeleteSuccess"))
      await loadData()
    } catch (error) {
      toast.error(getErrorMessage(error, t("toastDeleteFailed")))
    }
  }

  const changePassword = async () => {
    if (!newPassword) return
    try {
      await usersApi.changePassword(passwordUserID, { new_password: newPassword })
      toast.success(t("toastPasswordChangeSuccess"))
      setPasswordUserID("")
      setNewPassword("")
    } catch (error) {
      toast.error(getErrorMessage(error, t("toastPasswordChangeFailed")))
    }
  }

  const lockUser = async () => {
    if (!lockTarget) return
    try {
      await usersApi.lock(lockTarget.id, { reason: lockReason, duration_minutes: Number(lockMinutes) })
      toast.success(t("toastLockSuccess"))
      setLockTarget(null)
      await loadData()
    } catch (error) {
      toast.error(getErrorMessage(error, t("toastLockFailed")))
    }
  }

  const unlockUser = async (id: string) => {
    try {
      await usersApi.unlock(id)
      toast.success(t("toastUnlockSuccess"))
      await loadData()
    } catch (error) {
      toast.error(getErrorMessage(error, t("toastUnlockFailed")))
    }
  }

  const openCreateRole = () => {
    setEditingRoleID("")
    setRoleForm(emptyRoleForm)
    setRoleDialog("create")
  }

  const openEditRole = (role: Role) => {
    setEditingRoleID(role.id)
    setRoleForm({
      key: role.key,
      name: role.name,
      description: role.description,
      parent_key: role.parent_key || "",
      permission_codes: [...role.permission_codes],
    })
    setRoleDialog("edit")
  }

  const togglePermission = (code: string) => {
    setRoleForm((current) => ({
      ...current,
      permission_codes: current.permission_codes.includes(code)
        ? current.permission_codes.filter((item) => item !== code)
        : [...current.permission_codes, code],
    }))
  }

  const saveRole = async () => {
    if (!roleForm.name || (roleDialog === "create" && !roleForm.key)) {
      toast.error(t("rbacRoleFormIncomplete"))
      return
    }
    const request: RoleRequest = {
      key: roleDialog === "create" ? roleForm.key : undefined,
      name: roleForm.name,
      description: roleForm.description,
      parent_key: roleForm.parent_key || null,
      permission_codes: roleForm.permission_codes,
    }
    try {
      if (roleDialog === "create") await rolesApi.create(request)
      else await rolesApi.update(editingRoleID, request)
      toast.success(roleDialog === "create" ? t("rbacRoleCreateSuccess") : t("rbacRoleUpdateSuccess"))
      setRoleDialog(null)
      await loadData()
    } catch (error) {
      toast.error(getErrorMessage(error, t("rbacRoleSaveFailed")))
    }
  }

  const deleteRole = async (role: Role) => {
    if (!(await requestConfirm({ description: t("rbacRoleDeleteConfirm", { name: role.name }), variant: "destructive" }))) return
    try {
      await rolesApi.delete(role.id)
      toast.success(t("rbacRoleDeleteSuccess"))
      await loadData()
    } catch (error) {
      toast.error(getErrorMessage(error, t("rbacRoleDeleteFailed")))
    }
  }

  const selectedPermission = permissions.find((permission) => permission.code === grantPermissionCode)
  const resourceType = selectedPermission?.resource.split("/")[0] || ""

  const grantResource = async () => {
    if (!grantSubjectID || !grantPermissionCode || !resourceType || !grantResourceID) {
      toast.error(t("rbacGrantFormIncomplete"))
      return
    }
    try {
      await resourceGrantsApi.grant({
        subject_type: grantSubjectType,
        subject_id: grantSubjectID,
        permission_code: grantPermissionCode,
        resource_type: resourceType,
        resource_id: grantResourceID,
      })
      const response = await resourceGrantsApi.list(grantSubjectType, grantSubjectID)
      setResourceGrants(response.data || [])
      setGrantResourceID("")
      toast.success(t("rbacGrantSuccess"))
    } catch (error) {
      toast.error(getErrorMessage(error, t("rbacGrantFailed")))
    }
  }

  const revokeGrant = async (grant: ResourceGrant) => {
    try {
      await resourceGrantsApi.revoke({
        subject_type: grant.subject_type,
        subject_id: grant.subject_id,
        permission_code: grant.permission_code,
        resource_type: grant.resource_type,
        resource_id: grant.resource_id,
      })
      setResourceGrants((current) => current.filter((item) => item.id !== grant.id))
      toast.success(t("rbacRevokeSuccess"))
    } catch (error) {
      toast.error(getErrorMessage(error, t("rbacRevokeFailed")))
    }
  }

  const userColumns = useUserColumns({
    onEdit: openEditUser,
    onDelete: deleteUser,
    onChangePassword: setPasswordUserID,
    onLock: (id, username) => setLockTarget({ id, username }),
    onUnlock: (id) => void unlockUser(id),
  })
  const permissionColumns = usePermissionColumns()

  const roleFilters = useMemo(() => [{
    column: "role",
    title: t("filterRoleTitle"),
    options: roles.map((role) => ({ label: role.name, value: role.key, icon: Shield })),
  }], [roles, t])

  return (
    <>
      <PageHeader title={t("pageTitle")} />
      <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 pt-0 md:p-6 md:pt-0">
      {confirmDialog}
      <p className="text-sm text-muted-foreground">{t("rbacPageDescription")}</p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card><CardHeader className="pb-2"><CardDescription>{t("statsTotalUsers")}</CardDescription><CardTitle>{users.length}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>{t("rbacRoleCount")}</CardDescription><CardTitle>{roles.length}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>{t("rbacPermissionCount")}</CardDescription><CardTitle>{permissions.length}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>{t("rbacResourceGrantCount")}</CardDescription><CardTitle>{resourceGrants.length}</CardTitle></CardHeader></Card>
      </div>

      <Tabs defaultValue="users" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="w-full justify-start overflow-x-auto sm:w-fit">
          <TabsTrigger value="users"><Users className="mr-2 h-4 w-4" />{t("tabUsers")}</TabsTrigger>
          <TabsTrigger value="roles"><Shield className="mr-2 h-4 w-4" />{t("rbacRolesTab")}</TabsTrigger>
          <TabsTrigger value="permissions"><KeyRound className="mr-2 h-4 w-4" />{t("tabPermissions")}</TabsTrigger>
          <TabsTrigger value="resources"><Lock className="mr-2 h-4 w-4" />{t("rbacResourcesTab")}</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="min-h-[520px] flex-1">
          <DataTable
            data={users}
            columns={userColumns}
            loading={loading || refreshing}
            emptyMessage={t("tableEmpty")}
            enableRowSelection
            density="compact"
            className="min-h-[520px]"
            toolbar={(table) => (
              <DataTableToolbar table={table} searchKey="username" searchPlaceholder={t("searchPlaceholder")} filters={roleFilters} showRefresh={false}>
                <Button size="sm" onClick={openCreateUser}><Plus className="mr-2 h-4 w-4" />{t("btnNewUser")}</Button>
                <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}><RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />{tCommon("tableRefresh")}</Button>
              </DataTableToolbar>
            )}
          />
        </TabsContent>

        <TabsContent value="roles" className="flex-1">
          <div className="mb-3 flex justify-end"><Button size="sm" onClick={openCreateRole}><Plus className="mr-2 h-4 w-4" />{t("rbacNewRole")}</Button></div>
          <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {roles.map((role) => (
              <Card key={role.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div><CardTitle className="flex items-center gap-2">{role.name}{role.system && <Badge variant="secondary">System</Badge>}</CardTitle><CardDescription className="font-mono">{role.key}</CardDescription></div>
					{!role.system && <div className="flex gap-1"><Button variant="ghost" size="icon" onClick={() => openEditRole(role)}><Edit className="h-4 w-4" /></Button><Button variant="ghost" size="icon" onClick={() => void deleteRole(role)}><Trash2 className="h-4 w-4 text-destructive" /></Button></div>}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3"><p className="text-sm text-muted-foreground">{role.description || t("rbacNoDescription")}</p>{role.parent_key && <p className="text-xs">{t("rbacInheritedFrom")}: <code>{role.parent_key}</code></p>}<div className="flex flex-wrap gap-1">{role.effective_permission_codes.map((code) => <Badge key={code} variant={role.permission_codes.includes(code) ? "default" : "outline"} className="font-mono text-[10px]">{code}</Badge>)}</div></CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="permissions" className="min-h-[520px] flex-1">
          <DataTable className="min-h-[520px]" data={permissions} columns={permissionColumns} loading={loading} emptyMessage={t("permTableEmpty")} density="compact" toolbar={(table) => <DataTableToolbar table={table} searchKey="name" searchPlaceholder={t("permSearchPlaceholder")} showRefresh={false} />} />
        </TabsContent>

        <TabsContent value="resources" className="flex-1">
          <Card>
            <CardHeader><CardTitle>{t("rbacResourceGrantTitle")}</CardTitle><CardDescription>{t("rbacResourceGrantDescription")}</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Select value={grantSubjectType} onValueChange={(value) => { setGrantSubjectType(value as "role" | "user"); setGrantSubjectID("") }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="role">{t("rbacSubjectRole")}</SelectItem><SelectItem value="user">{t("rbacSubjectUser")}</SelectItem></SelectContent></Select>
                <Select value={grantSubjectID} onValueChange={setGrantSubjectID}><SelectTrigger><SelectValue placeholder={t("rbacSelectSubject")} /></SelectTrigger><SelectContent>{grantSubjectType === "role" ? roles.map((role) => <SelectItem key={role.key} value={role.key}>{role.name}</SelectItem>) : users.map((user) => <SelectItem key={user.id} value={user.id}>{user.username}</SelectItem>)}</SelectContent></Select>
                <Select value={grantPermissionCode} onValueChange={setGrantPermissionCode}><SelectTrigger><SelectValue placeholder={t("rbacSelectPermission")} /></SelectTrigger><SelectContent>{permissions.filter((permission) => permission.resource === "server/*").map((permission) => <SelectItem key={permission.code} value={permission.code}>{permission.name}</SelectItem>)}</SelectContent></Select>
                <Input value={grantResourceID} onChange={(event) => setGrantResourceID(event.target.value)} placeholder={t("rbacResourceIDPlaceholder")} />
              </div>
              <div className="flex justify-end"><Button onClick={() => void grantResource()}>{t("rbacGrantButton")}</Button></div>
              <div className="space-y-2">{resourceGrants.map((grant) => <div key={grant.id} className="flex items-center justify-between rounded-md border p-3"><div><div className="font-mono text-sm">{grant.permission_code}</div><div className="text-xs text-muted-foreground">{grant.resource_type}/{grant.resource_id}</div></div><Button variant="ghost" size="sm" onClick={() => void revokeGrant(grant)}><Unlock className="mr-2 h-4 w-4" />{t("rbacRevokeButton")}</Button></div>)}</div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={userDialog !== null} onOpenChange={(open) => !open && setUserDialog(null)}><DialogContent><DialogHeader><DialogTitle>{userDialog === "create" ? t("dialogCreateTitle") : t("dialogEditTitle")}</DialogTitle></DialogHeader><div className="space-y-3"><Label>{t("fieldUsername")}</Label><Input value={userForm.username} onChange={(event) => setUserForm({ ...userForm, username: event.target.value })} /><Label>{t("fieldEmail")}</Label><Input type="email" value={userForm.email} onChange={(event) => setUserForm({ ...userForm, email: event.target.value })} />{userDialog === "create" && <><Label>{t("fieldPassword")}</Label><Input type="password" value={userForm.password} onChange={(event) => setUserForm({ ...userForm, password: event.target.value })} /></>}<Label>{t("fieldRole")}</Label><Select value={userForm.role} onValueChange={(role) => setUserForm({ ...userForm, role })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{roles.map((role) => <SelectItem key={role.key} value={role.key}>{role.name}</SelectItem>)}</SelectContent></Select></div><DialogFooter><Button variant="outline" onClick={() => setUserDialog(null)}>{t("dialogCancel")}</Button><Button onClick={() => void saveUser()}>{t("dialogCreateSubmit")}</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={Boolean(passwordUserID)} onOpenChange={(open) => !open && setPasswordUserID("")}><DialogContent><DialogHeader><DialogTitle>{t("dialogPasswordTitle")}</DialogTitle></DialogHeader><Input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /><DialogFooter><Button variant="outline" onClick={() => setPasswordUserID("")}>{t("dialogCancel")}</Button><Button onClick={() => void changePassword()}>{t("dialogPasswordSubmit")}</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={Boolean(lockTarget)} onOpenChange={(open) => !open && setLockTarget(null)}><DialogContent><DialogHeader><DialogTitle>{t("dialogLockTitle")}</DialogTitle><DialogDescription>{lockTarget?.username}</DialogDescription></DialogHeader><Label>{t("fieldLockDuration")}</Label><Input type="number" min={1} value={lockMinutes} onChange={(event) => setLockMinutes(event.target.value)} /><Label>{t("fieldLockReason")}</Label><Input value={lockReason} onChange={(event) => setLockReason(event.target.value)} /><DialogFooter><Button variant="outline" onClick={() => setLockTarget(null)}>{t("dialogCancel")}</Button><Button variant="destructive" onClick={() => void lockUser()}>{t("dialogLockSubmit")}</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={roleDialog !== null} onOpenChange={(open) => !open && setRoleDialog(null)}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{roleDialog === "create" ? t("rbacCreateRoleTitle") : t("rbacEditRoleTitle")}</DialogTitle><DialogDescription>{t("rbacRoleDialogDescription")}</DialogDescription></DialogHeader><div className="grid gap-3 sm:grid-cols-2">{roleDialog === "create" && <div><Label>{t("rbacRoleKey")}</Label><Input className="font-mono" value={roleForm.key} onChange={(event) => setRoleForm({ ...roleForm, key: event.target.value })} placeholder="ops-readonly" /></div>}<div><Label>{t("rbacRoleName")}</Label><Input value={roleForm.name} onChange={(event) => setRoleForm({ ...roleForm, name: event.target.value })} /></div><div className="sm:col-span-2"><Label>{t("rbacRoleDescription")}</Label><Textarea value={roleForm.description} onChange={(event) => setRoleForm({ ...roleForm, description: event.target.value })} /></div><div className="sm:col-span-2"><Label>{t("rbacParentRole")}</Label><Select value={roleForm.parent_key || "none"} onValueChange={(value) => setRoleForm({ ...roleForm, parent_key: value === "none" ? "" : value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{t("rbacNoParent")}</SelectItem>{roles.filter((role) => role.id !== editingRoleID).map((role) => <SelectItem key={role.key} value={role.key}>{role.name}</SelectItem>)}</SelectContent></Select></div><div className="sm:col-span-2"><Label>{t("rbacDirectPermissions")}</Label><div className="mt-2 grid gap-2 sm:grid-cols-2">{permissions.map((permission) => <Label key={permission.code} className="flex cursor-pointer items-start gap-2 rounded-md border p-3"><Checkbox checked={roleForm.permission_codes.includes(permission.code)} onCheckedChange={() => togglePermission(permission.code)} /><span><span className="block text-sm font-medium">{permission.name}</span><code className="text-xs text-muted-foreground">{permission.code}</code></span></Label>)}</div></div></div><DialogFooter><Button variant="outline" onClick={() => setRoleDialog(null)}>{t("dialogCancel")}</Button><Button onClick={() => void saveRole()}>{t("rbacSaveRole")}</Button></DialogFooter></DialogContent></Dialog>
      </div>
    </>
  )
}
