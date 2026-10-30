

import * as React from "react"

import { Loader2, Upload, X, Paintbrush } from "lucide-react"

import { Button } from "@easyssh/app/components/ui/button"
import { Input } from "@easyssh/app/components/ui/input"
import { Label } from "@easyssh/app/components/ui/label"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@easyssh/app/components/ui/select"

import { useClientAuth } from "@easyssh/app/components/client-auth-provider"
import { useSystemConfig } from "@easyssh/app/contexts/system-config-context"

import { ownerApi } from "../../lib/api/owner"

import { toast } from "sonner"
import { useTranslation } from "react-i18next"

import { getErrorMessage } from "@easyssh/app/lib/error-utils"

export function AccountProfile() {
  const { t: tAccount } = useTranslation("accountSettings")
  const { user, refreshUser, updatePreferences } = useClientAuth()
  const { config } = useSystemConfig()
  // 个人信息表单状态
  const [profileForm, setProfileForm] = React.useState({
    username: "",
    email: "",
  })
  const [profileLoading, setProfileLoading] = React.useState(false)

  // 头像上传状态
  const [avatarFile, setAvatarFile] = React.useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = React.useState<string>("")
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  // 个人偏好状态（时区）
  const [preferencesForm, setPreferencesForm] = React.useState({
    timezone: "",
  })
  const [preferencesLoading, setPreferencesLoading] = React.useState(false)

  React.useEffect(() => { if (user) { setProfileForm({ username: user.username || "", email: user.email || "" }); setAvatarFile(null); setAvatarPreview(user.avatar || ""); setPreferencesForm({ timezone: user.timezone || config?.default_timezone || "Asia/Shanghai" }) } }, [user, config?.default_timezone])
  // 处理头像文件选择
  const handleAvatarSelect = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // 验证文件类型
    if (!file.type.startsWith('image/')) {
      toast.error(tAccount("avatarFileTypeError"))
      return
    }

    // 验证文件大小（限制 5MB）
    if (file.size > 5 * 1024 * 1024) {
      toast.error(tAccount("avatarFileSizeError"))
      return
    }

    setAvatarFile(file)

    // 生成预览
    const reader = new FileReader()
    reader.onloadend = () => {
      setAvatarPreview(reader.result as string)
    }
    reader.readAsDataURL(file)
  }, [tAccount])

  // 清空头像预览（不立即保存）
  const handleRemoveAvatar = React.useCallback(() => {
    setAvatarFile(null)
    setAvatarPreview("")
  }, [])

  // 生成 DiceBear 头像
  const handleGenerateDiceBearAvatar = React.useCallback(() => {
    // 使用随机种子生成不同的头像
    const randomSeed = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
    const dicebearUrl = `https://api.dicebear.com/7.x/notionists-neutral/svg?seed=${randomSeed}`

    // 获取 SVG 并转换为 base64
    fetch(dicebearUrl)
      .then(response => response.text())
      .then(svgText => {
        // 将 SVG 转换为 data URL
        const base64 = btoa(unescape(encodeURIComponent(svgText)))
        const dataUrl = `data:image/svg+xml;base64,${base64}`
        setAvatarPreview(dataUrl)
        setAvatarFile(null)
        toast.success(tAccount("avatarGenerateSuccess"))
      })
      .catch(error => {
        console.error("Failed to generate avatar:", error)
        toast.error(tAccount("avatarGenerateFailed"))
      })
  }, [tAccount])

  // 压缩图片
  const compressImage = (file: File, maxWidth: number, maxHeight: number): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        const img = document.createElement('img')
        img.onload = () => {
          const canvas = document.createElement('canvas')
          let width = img.width
          let height = img.height

          // 计算缩放比例（保持宽高比，缩放到正方形）
          const size = Math.min(maxWidth, maxHeight)
          if (width > height) {
            if (width > size) {
              height = (height * size) / width
              width = size
            }
          } else {
            if (height > size) {
              width = (width * size) / height
              height = size
            }
          }

          canvas.width = width
          canvas.height = height

        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error("Failed to get canvas context"))
          return
        }

          // 绘制白色背景（避免透明背景转 JPEG 变黑）
          ctx.fillStyle = '#FFFFFF'
          ctx.fillRect(0, 0, width, height)
          ctx.drawImage(img, 0, 0, width, height)

          // 转换为 base64（JPEG 格式，质量 0.6 降低文件大小）
          const base64 = canvas.toDataURL('image/jpeg', 0.6)

          // 检查 base64 大小（如果超过 500KB 则进一步降低质量）
          if (base64.length > 500 * 1024) {
            const smallerBase64 = canvas.toDataURL('image/jpeg', 0.4)
            resolve(smallerBase64)
          } else {
            resolve(base64)
          }
        }
        img.onerror = () => reject(new Error("Image load failed"))
        img.src = e.target?.result as string
      }
      reader.onerror = () => reject(new Error("File read failed"))
      reader.readAsDataURL(file)
    })
  }

  // 保存个人信息：资料接口整体替换，语言与时区沿用当前值
  const handleSaveProfile = React.useCallback(async () => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(profileForm.email)) {
      toast.error(tAccount("toastInvalidEmail"))
      return
    }

    setProfileLoading(true)
    try {
      const avatar = avatarFile ? await compressImage(avatarFile, 128, 128) : avatarPreview
      await ownerApi.updateProfile({
        username: profileForm.username.trim(),
        email: profileForm.email.trim(),
        avatar,
        language: user?.language,
        timezone: user?.timezone,
      })
      await refreshUser()
      setAvatarFile(null)
      toast.success(tAccount("toastProfileSaved"))
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, tAccount("toastSaveFailed")))
    } finally {
      setProfileLoading(false)
    }
  }, [profileForm, avatarFile, avatarPreview, refreshUser, tAccount, user?.language, user?.timezone])

  // 保存个人偏好（时区）
  const handleSavePreferences = React.useCallback(async () => {
    if (!preferencesForm.timezone) {
      toast.error(tAccount("toastTimezoneRequired"))
      return
    }

    setPreferencesLoading(true)
    try {
      await updatePreferences?.({ timezone: preferencesForm.timezone })
      toast.success(tAccount("toastPreferencesSaved"))
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, tAccount("toastSaveFailed")))
    } finally {
      setPreferencesLoading(false)
    }
  }, [preferencesForm, tAccount, updatePreferences])

return (<div className="space-y-4">
                    <div className="rounded-lg border p-4">
                      <h4 className="font-medium mb-2">
                        {tAccount("avatarTitle")}
                      </h4>
                      <p className="text-sm text-muted-foreground mb-3">
                        {tAccount("avatarDescription")}
                      </p>
                      <div className="flex items-center gap-4">
                        {/* 头像显示 - 可点击上传 */}
                        <div
                          className="relative h-20 w-20 rounded-full overflow-hidden border-2 border-border cursor-pointer group"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          {avatarPreview ? (
                            <img
                              src={avatarPreview}
                              alt={tAccount("avatarPreviewAlt")}
                              width={80}
                              height={80}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="h-full w-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white text-2xl font-semibold">
                              {user?.username?.charAt(0)?.toUpperCase() || "U"}
                            </div>
                          )}
                          {/* 悬浮时显示上传图标 */}
                          <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <Upload className="h-6 w-6 text-white" />
                          </div>
                        </div>

                        {/* 操作按钮 */}
                        <div className="flex flex-col gap-2">
                          <div className="flex gap-2">
                            <input
                              ref={fileInputRef}
                              type="file"
                              accept="image/*"
                              onChange={handleAvatarSelect}
                              className="hidden"
                            />
                            {avatarPreview && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={handleRemoveAvatar}
                              >
                                <X className="h-4 w-4 mr-1" />
                                {tAccount("avatarRemove")}
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleGenerateDiceBearAvatar}
                            >
                              <Paintbrush className="h-4 w-4 mr-1" />
                              {tAccount("avatarGenerate")}
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {tAccount("avatarSupportHint")}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-lg border p-4">
                      <h4 className="font-medium mb-2">
                        {tAccount("basicInfoTitle")}
                      </h4>
                      <p className="text-sm text-muted-foreground mb-3">
                        {tAccount("basicInfoDescription")}
                      </p>
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="username">
                            {tAccount("usernameLabel")}
                          </Label>
                          <Input
                            id="username"
                            placeholder={tAccount("usernamePlaceholder")}
                            value={profileForm.username}
                            onChange={(e) => setProfileForm(prev => ({ ...prev, username: e.target.value }))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="email">
                            {tAccount("emailLabel")}
                          </Label>
                          <Input
                            id="email"
                            type="email"
                            placeholder={tAccount("emailPlaceholder")}
                            value={profileForm.email}
                            onChange={(e) => setProfileForm(prev => ({ ...prev, email: e.target.value }))}
                          />
                        </div>
                        <Button
                          className="mt-4"
                          onClick={handleSaveProfile}
                          disabled={profileLoading}
                        >
                          {profileLoading && (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          )}
                          {tAccount("saveProfileButton")}
                        </Button>
                      </div>
                    </div>
                    <div className="rounded-lg border p-4">
                      <h4 className="font-medium mb-2">
                        {tAccount("preferencesTitle")}
                      </h4>
                      <p className="text-sm text-muted-foreground mb-3">
                        {tAccount("preferencesDescription")}
                      </p>
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="timezone">
                            {tAccount("timezoneLabel")}
                          </Label>
                          <Select
                            value={preferencesForm.timezone}
                            onValueChange={(value) =>
                              setPreferencesForm((prev) => ({ ...prev, timezone: value }))
                            }
                          >
                            <SelectTrigger id="timezone" className="w-full">
                              <SelectValue placeholder={tAccount("timezonePlaceholder")} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Asia/Shanghai">
                                {tAccount("timezoneOptionAsiaShanghai")}
                              </SelectItem>
                              <SelectItem value="Asia/Tokyo">
                                {tAccount("timezoneOptionAsiaTokyo")}
                              </SelectItem>
                              <SelectItem value="Asia/Hong_Kong">
                                {tAccount("timezoneOptionAsiaHongKong")}
                              </SelectItem>
                              <SelectItem value="America/New_York">
                                {tAccount("timezoneOptionAmericaNewYork")}
                              </SelectItem>
                              <SelectItem value="America/Los_Angeles">
                                {tAccount("timezoneOptionAmericaLosAngeles")}
                              </SelectItem>
                              <SelectItem value="Europe/London">
                                {tAccount("timezoneOptionEuropeLondon")}
                              </SelectItem>
                              <SelectItem value="Europe/Paris">
                                {tAccount("timezoneOptionEuropeParis")}
                              </SelectItem>
                              <SelectItem value="UTC">
                                {tAccount("timezoneOptionUTC")}
                              </SelectItem>
                            </SelectContent>
                          </Select>

                        </div>
                        <Button
                          className="mt-2"
                          onClick={handleSavePreferences}
                          disabled={preferencesLoading}
                        >
                          {preferencesLoading && (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          )}
                          {tAccount("savePreferencesButton")}
                        </Button>
                      </div>
                    </div>
                  </div>)
}
