

import * as React from "react"

import { Loader2, Upload, X, Paintbrush } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

import { useClientAuth } from "@/components/client-auth-provider"
import { useSystemConfig } from "@/contexts/system-config-context"

import { authApi } from "@/lib/api/auth"

import { toast } from "sonner"
import { useTranslation } from "react-i18next"

import { getErrorMessage } from "@/lib/error-utils"

export function AccountProfile() {
  const { t: tAccount } = useTranslation("accountSettings")
  const { t: tCommon } = useTranslation("common")
  const { user, refreshUser } = useClientAuth()
  const { config } = useSystemConfig()
  // 个人信息表单状态
  const [profileForm, setProfileForm] = React.useState({
    username: "",
    email: "",
    verificationCode: "", // 邮箱验证码
  })
  const [profileLoading, setProfileLoading] = React.useState(false)
  const [sendingCode, setSendingCode] = React.useState(false) // 发送验证码加载状态
  const [countdown, setCountdown] = React.useState(0) // 验证码倒计时
  const [originalEmail, setOriginalEmail] = React.useState("") // 原始邮箱地址，用于判断是否修改

  // 头像上传状态
  const [avatarFile, setAvatarFile] = React.useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = React.useState<string>("")
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  // 个人偏好状态（时区）
  const [preferencesForm, setPreferencesForm] = React.useState({
    timezone: "",
  })
  const [preferencesLoading, setPreferencesLoading] = React.useState(false)

  React.useEffect(() => { if (user) { setProfileForm({ username: user.username || "", email: user.email || "", verificationCode: "" }); setOriginalEmail(user.email || ""); setAvatarFile(null); setAvatarPreview(user.avatar || ""); setPreferencesForm({ timezone: user.timezone || config?.default_timezone || "Asia/Shanghai" }) } }, [user, config?.default_timezone])
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

  // 验证码倒计时逻辑
  React.useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000)
      return () => clearTimeout(timer)
    }
  }, [countdown])

  // 发送验证码
  const handleSendVerificationCode = React.useCallback(async () => {
    // 验证邮箱格式
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!profileForm.email || !emailRegex.test(profileForm.email)) {
      toast.error(tAccount("toastInvalidEmail"))
      return
    }

    // 检查邮箱是否已修改
    if (profileForm.email === originalEmail) {
      toast.error(tAccount("toastEmailNotChanged"))
      return
    }

    setSendingCode(true)
    try {
      await authApi.sendVerificationCode(profileForm.email, "email_change")
      toast.success(tAccount("toastCodeSent"))
      setCountdown(60) // 开始60秒倒计时
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, tAccount("toastCodeSendFailed")))
    } finally {
      setSendingCode(false)
    }
  }, [profileForm.email, originalEmail, tAccount])

  // 保存个人信息
  const handleSaveProfile = React.useCallback(async () => {

    // 验证邮箱格式
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (profileForm.email && !emailRegex.test(profileForm.email)) {
      toast.error(tAccount("toastInvalidEmail"))
      return
    }

    // 如果用户修改了邮箱，必须输入验证码
    if (profileForm.email !== originalEmail) {
      if (!profileForm.verificationCode || profileForm.verificationCode.length !== 6) {
        toast.error(tAccount("toastVerificationCodeRequired"))
        return
      }
    }

    setProfileLoading(true)
    try {
      let finalAvatar = avatarPreview

      // 如果选择了新图片文件，需要压缩
      if (avatarFile) {
        finalAvatar = await compressImage(avatarFile, 128, 128)
      }

      // 保存个人信息和头像（包含验证码如果邮箱有变更）
      await authApi.updateProfile({
        username: profileForm.username,
        email: profileForm.email,
        avatar: finalAvatar, // 包含头像数据
        verification_code: profileForm.email !== originalEmail ? profileForm.verificationCode : undefined,
      })
      await refreshUser()
      setAvatarFile(null) // 清除文件选择状态
      setProfileForm(prev => ({ ...prev, verificationCode: "" })) // 清除验证码
      setOriginalEmail(profileForm.email) // 更新原始邮箱
      toast.success(tAccount("toastProfileSaved"))
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, tAccount("toastSaveFailed")))
    } finally {
      setProfileLoading(false)
    }
  }, [profileForm, originalEmail, avatarFile, avatarPreview, refreshUser, tAccount])

  // 保存个人偏好（时区）
  const handleSavePreferences = React.useCallback(async () => {
    if (!preferencesForm.timezone) {
      toast.error(tAccount("toastTimezoneRequired"))
      return
    }

    setPreferencesLoading(true)
    try {
      await authApi.updateProfile({
        timezone: preferencesForm.timezone,
      })
      await refreshUser()
      toast.success(tAccount("toastPreferencesSaved"))
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, tAccount("toastSaveFailed")))
    } finally {
      setPreferencesLoading(false)
    }
  }, [preferencesForm, refreshUser, tAccount])

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
                        {/* 如果邮箱已修改，显示验证码输入 */}
                        {profileForm.email !== originalEmail && profileForm.email && (
                          <div className="space-y-2">
                            <Label htmlFor="verification-code">
                              {tAccount("verificationCodeLabel")}
                            </Label>
                            <div className="flex gap-2">
                              <Input
                                id="verification-code"
                                placeholder={tAccount("verificationCodePlaceholder")}
                                value={profileForm.verificationCode}
                                onChange={(e) => setProfileForm(prev => ({ ...prev, verificationCode: e.target.value }))}
                                maxLength={6}
                                className="flex-1"
                              />
                              <Button
                                type="button"
                                variant="outline"
                                onClick={handleSendVerificationCode}
                                disabled={sendingCode || countdown > 0}
                                className="shrink-0"
                              >
                                {sendingCode && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {countdown > 0 ? `${countdown}s` : tAccount("sendCodeButton")}
                              </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {tAccount("verificationCodeHint")}
                            </p>
                          </div>
                        )}
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
