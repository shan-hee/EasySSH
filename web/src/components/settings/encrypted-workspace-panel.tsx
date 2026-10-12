import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { allScopes, type Scope } from "@/lib/secure-runtime/crypto"
import type { EncryptedWorkspace } from "@/lib/secure-runtime/workspace"

const scopeNames: Record<Scope, string> = { config: "服务器、脚本和排序", credentials: "SSH 凭据", ai_config: "AI 设置", sessions: "会话记录" }
const resources: [Scope, string][] = [["config", "configuration"], ["config", "host-keys"], ["credentials", "credentials"], ["credentials", "ssh-keys"], ["ai_config", "ai_config"], ["sessions", "sessions"]]
type Conflict = { scope: Scope; resource: string; key: string; field: string; values: string[] }

export function EncryptedWorkspacePanel({ workspace, onLock, onSync }: { workspace: EncryptedWorkspace; onLock?: () => void; onSync?: () => Promise<void> }) {
  const [, render] = useState(0)
  const [password, setPassword] = useState("")
  const [name, setName] = useState("浏览器")
  const [code, setCode] = useState("")
  const [pairing, setPairing] = useState("")
  const [recovery, setRecovery] = useState("")
  const [pending, setPending] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [scopes, setScopes] = useState<Scope[]>(["config"])
  const [admin, setAdmin] = useState(false)
  const [conflicts, setConflicts] = useState<Conflict[]>([])
  useEffect(() => workspace.subscribe(() => { render((value) => value + 1); void refresh().catch(() => {}) }), [workspace])
  async function refresh() {
    setPending(!!await workspace.storage.read("unpublished"))
    if (workspace.view) {
      setRecovery(await workspace.pendingRecovery())
      setPairing(await workspace.pairingCode())
      const found: Conflict[] = []
      for (const [scope, resource] of resources) if (workspace.view.scopes.includes(scope)) {
        found.push(...(await workspace.conflicts(scope, resource)).map((conflict) => ({ ...conflict, scope, resource })))
      }
      setConflicts(found)
    } else {
      setRecovery(""); setPairing(""); setConflicts([])
    }
  }
  useEffect(() => { void refresh().catch(() => {}) }, [workspace])
  async function action(fn: () => Promise<unknown>) {
    setBusy(true); setError("")
    try { await fn(); setPassword(""); setCode("") }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { await refresh().catch(() => {}); setBusy(false); render((value) => value + 1) }
  }
  const view = workspace.view
  return <section className="mx-auto w-full max-w-3xl space-y-5 p-6" aria-label="加密工作区">
    <h2 className="text-xl font-semibold">加密工作区</h2>
    <p className="text-sm text-muted-foreground">同步内容在本机加密。解锁密码与账号密码独立，不会上传。恢复密钥丢失且所有设备不可用时，服务端无法恢复数据。</p>
    <p className="text-sm text-muted-foreground">浏览器继续信任本站下发的网页；此方案不抵御服务端被攻破后篡改网页代码。</p>
    {(error || workspace.error) && <p role="alert" className="text-sm text-destructive">{error || workspace.error}</p>}
    <fieldset disabled={busy} className="space-y-4 disabled:opacity-60">
      {!view && <>
        <label className="block space-y-2">设备名称<Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
        <label className="block space-y-2">本机解锁密码（至少 12 字节）<Input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void action(() => workspace.unlock(password))}>解锁本机</Button>
          <Button variant="outline" onClick={() => void action(() => workspace.initialize(password, name))}>创建加密空间</Button>
          <Button variant="outline" onClick={() => void action(() => workspace.pairingRequest(password, name))}>生成配对请求</Button>
        </div>
        <label className="block space-y-2">恢复密钥<Input type="password" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} /></label>
        <Button variant="outline" onClick={() => void action(() => workspace.recover(code.trim(), password, name))}>用恢复密钥恢复</Button>
      </>}
      {pending && view && <div className="space-y-3 rounded border p-4">
        {recovery && <><p>请将恢复密钥保存在离线安全位置，然后确认继续。</p><textarea aria-label="恢复密钥" readOnly rows={4} className="w-full break-all rounded border p-2 font-mono text-xs" value={recovery} />
          <label className="flex items-center gap-2"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />我已安全保存恢复密钥</label></>}
        <Button disabled={!!recovery && !confirmed} onClick={() => void action(() => workspace.publishInitialization(confirmed))}>发布加密空间</Button>
      </div>}
      {pairing && <div className="space-y-3"><p>将下方请求交给已有管理员设备授权，然后点击完成配对。请在两端核对空间和设备指纹。</p>
        <textarea aria-label="配对请求" readOnly rows={5} className="w-full rounded border p-2 text-xs" value={pairing} />
        <Button onClick={() => void action(() => workspace.completePairing())}>完成配对</Button>
      </div>}
      {!!view?.manifest.revision && !pending && <>
        {conflicts.length > 0 && <div className="space-y-4 rounded border border-destructive p-4">
          <p>发现 {conflicts.length} 项并发修改。请比较版本并选择保留值；展开凭据版本会在本机显示敏感内容。</p>
          {conflicts.map((conflict) => <div key={`${conflict.scope}/${conflict.resource}/${conflict.key}/${conflict.field}`} className="space-y-2">
            <p className="break-all text-sm">{scopeNames[conflict.scope]} · {conflict.key} · {conflict.field}</p>
            {conflict.values.map((value, index) => <details key={value} className="rounded border p-2">
              <summary>版本 {index + 1}</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{value}</pre>
              <Button className="mt-2" onClick={() => void action(() => workspace.resolve(conflict.scope, conflict.resource, conflict.key, conflict.field, value))}>保留此版本</Button>
            </details>)}
          </div>)}
        </div>}
        <p className="break-all text-xs">空间指纹：{view.manifest.space}<br />本机指纹：{view.device.id}</p>
        <div className="flex flex-wrap gap-2"><Button onClick={() => void action(() => onSync ? onSync() : workspace.sync())}>立即同步</Button>
          <Button variant="outline" onClick={() => void action(() => workspace.sync(true))}>确认密钥轮换并同步离线更改</Button>
          {onLock && <Button variant="outline" onClick={onLock}>锁定工作区</Button>}</div>
        {view.admin && <div className="space-y-3 rounded border p-4">
          <label className="block space-y-2">其他设备的配对请求<textarea className="w-full rounded border p-2 text-xs" rows={4} value={code} onChange={(e) => setCode(e.target.value)} /></label>
          {allScopes.map((scope) => <label key={scope} className="flex items-center gap-2"><input type="checkbox" checked={admin || scopes.includes(scope)} disabled={admin || scope === "config"} onChange={(e) => setScopes(e.target.checked ? [...scopes, scope] : scopes.filter((s) => s !== scope))} />{scopeNames[scope]}</label>)}
          <label className="flex items-center gap-2"><input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} />允许管理其他设备（包含全部数据范围）</label>
          <Button onClick={() => void action(() => workspace.authorize(code.trim(), scopes, admin))}>授权设备</Button>
        </div>}
        <p className="text-sm text-muted-foreground">撤销会轮换后续数据的密钥，无法收回设备已经保存的旧副本。</p>
        <ul className="space-y-3">{view.manifest.devices.map((grant) => <li key={grant.device.id} className="rounded border p-3">
          <p>{grant.device.name}{grant.admin ? " · 管理员" : ""}{grant.device.id === view.device.id ? " · 本机" : ""}</p>
          <p className="break-all text-xs text-muted-foreground">{grant.device.id}</p>
          <p className="text-sm">{grant.scopes.map((s) => scopeNames[s]).join("、")}</p>
          {view.admin && grant.device.id !== view.device.id && <Button variant="destructive" className="mt-2" onClick={() => void action(() => workspace.revoke(grant.device.id))}>撤销并轮换密钥</Button>}
        </li>)}</ul>
        {workspace.lastSync && <p className="text-xs text-muted-foreground">上次同步：{new Date(workspace.lastSync).toLocaleString()}</p>}
      </>}
    </fieldset>
  </section>
}
