
import { useEffect, useId, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  useForm,
  type DefaultValues,
  type FieldValues,
  type Resolver,
  type UseFormReturn,
} from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import type * as z4 from "zod/v4/core"
import { toast } from "sonner"
import { useAuthReady } from "@/hooks/use-auth-ready"
import { useTranslation } from "react-i18next"
import { queryKeys } from "@/lib/query-keys"
import { useSettingsActionsRegister } from "@/components/settings/settings-actions"

interface UseSettingsFormOptions<T extends FieldValues> {
  cacheKey: string
  schema: z4.$ZodType<T, T>
  loadFn: () => Promise<T>
  saveFn: (data: T) => Promise<void>
  onSuccess?: () => void
  onError?: (error: Error) => void
  defaultValues?: Partial<T>
}

interface UseSettingsFormReturn<T extends FieldValues> {
  form: UseFormReturn<T>
  isLoading: boolean
  isSaving: boolean
  isDirty: boolean
  handleSave: () => Promise<void>
  reset: () => void
}

/**
 * 通用的设置表单Hook
 *
 * @param options 配置选项
 * @returns 表单实例和相关状态
 *
 * @example
 * const { form, isLoading, isSaving, isDirty, handleSave, reset } = useSettingsForm({
 *   cacheKey: "system",
 *   schema: systemConfigSchema,
 *   loadFn: settingsApi.getSystemConfig,
 *   saveFn: settingsApi.saveSystemConfig,
 * })
 */
export function useSettingsForm<T extends FieldValues>({
  cacheKey,
  schema,
  loadFn,
  saveFn,
  onSuccess,
  onError,
  defaultValues,
}: UseSettingsFormOptions<T>): UseSettingsFormReturn<T> {
  const { ready } = useAuthReady()
  const { t } = useTranslation("settingsCommon")
  const [isSaving, setIsSaving] = useState(false)
  const settingsQuery = useQuery({
    queryKey: queryKeys.settings.form(cacheKey),
    queryFn: loadFn,
    enabled: ready,
    // Refresh on entry, including when authentication becomes ready after mount.
    staleTime: 0,
    gcTime: 10 * 60 * 1000,
  })
  // Wait for this visit's read before allowing edits to cached settings.
  const [isFormInitialized, setIsFormInitialized] = useState(false)
  // 当前 zod / resolvers 的类型声明存在版本细节不兼容，
  // 这里保留官方 zodResolver 运行时实现，仅隔离有问题的重载推断。
  const createResolver = zodResolver as unknown as (schema: unknown) => Resolver<T>

  const form = useForm<T>({
    resolver: createResolver(schema),
    defaultValues: (settingsQuery.data ?? defaultValues) as DefaultValues<T> | undefined,
  })

  useEffect(() => {
    if (!settingsQuery.isFetchedAfterMount) return
    if (settingsQuery.data && !form.formState.isDirty) {
      form.reset(settingsQuery.data)
    }
    if (settingsQuery.data !== undefined) {
      setIsFormInitialized(true)
    }
  }, [form, form.formState.isDirty, settingsQuery.data, settingsQuery.isFetchedAfterMount])

  useEffect(() => {
    if (!settingsQuery.error) return
    const error = settingsQuery.error instanceof Error
      ? settingsQuery.error
      : new Error(t("errorUnknown"))
    toast.error(
      t("toastLoadFailed", {
        message: error.message || t("errorUnknown"),
      }),
    )
    onError?.(error)
  }, [onError, settingsQuery.error, t])

  // 保存配置；成功提示由调用方决定，便于多个表单合并为一次提示
  const save = async () => {
    const isValid = await form.trigger()
    if (!isValid) {
      toast.error(t("toastFormInvalid"))
      return false
    }

    const data = form.getValues()
    setIsSaving(true)

    try {
      await saveFn(data)
      const refreshed = await settingsQuery.refetch()
      if (refreshed.data) {
        form.reset(refreshed.data)
      }
      onSuccess?.()
      return true
    } catch (error) {
      const err = error as Error
      toast.error(
        t("toastSaveFailed", {
          message: err.message || t("errorUnknown"),
        })
      )
      onError?.(err)
      return false
    } finally {
      setIsSaving(false)
    }
  }

  const handleSave = async () => {
    if (await save()) toast.success(t("toastSaveSuccess"))
  }

  const reset = () => form.reset(
    (settingsQuery.data ?? defaultValues) as DefaultValues<T> | T | undefined,
  )

  // Inside the settings page every form reports to the shared header actions.
  const register = useSettingsActionsRegister()
  const id = useId()
  const isDirty = form.formState.isDirty
  const latest = useRef({ save, reset })
  latest.current = { save, reset }
  useEffect(() => {
    register?.(id, { dirty: isDirty, saving: isSaving, save: () => latest.current.save(), reset: () => latest.current.reset() })
  }, [register, id, isDirty, isSaving])
  useEffect(() => () => register?.(id, null), [register, id])

  return {
    form,
    isLoading: !isFormInitialized && !settingsQuery.error,
    isSaving,
    isDirty,
    handleSave,
    reset,
  }
}
