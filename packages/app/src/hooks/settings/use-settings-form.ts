
import { useEffect, useState } from "react"
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

interface UseSettingsFormOptions<T extends FieldValues> {
  cacheKey: string
  schema: z4.$ZodType<T, T>
  loadFn: () => Promise<T>
  saveFn: (data: T) => Promise<void>
  onSuccess?: () => void
  onError?: (error: Error) => void
  defaultValues?: Partial<T>
  refetchOnMount?: boolean | "always"
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
  refetchOnMount,
}: UseSettingsFormOptions<T>): UseSettingsFormReturn<T> {
  const { ready } = useAuthReady()
  const { t } = useTranslation("settingsCommon")
  const [isSaving, setIsSaving] = useState(false)
  const settingsQuery = useQuery({
    queryKey: queryKeys.settings.form(cacheKey),
    queryFn: loadFn,
    enabled: ready,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnMount,
  })
  const [isFormInitialized, setIsFormInitialized] = useState(
    () => settingsQuery.data !== undefined,
  )
  // 当前 zod / resolvers 的类型声明存在版本细节不兼容，
  // 这里保留官方 zodResolver 运行时实现，仅隔离有问题的重载推断。
  const createResolver = zodResolver as unknown as (schema: unknown) => Resolver<T>

  const form = useForm<T>({
    resolver: createResolver(schema),
    defaultValues: (settingsQuery.data ?? defaultValues) as DefaultValues<T> | undefined,
  })

  useEffect(() => {
    if (settingsQuery.data && !form.formState.isDirty) {
      form.reset(settingsQuery.data)
    }
    if (settingsQuery.data !== undefined) {
      setIsFormInitialized(true)
    }
  }, [form, form.formState.isDirty, settingsQuery.data])

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

  // 保存配置
  const handleSave = async () => {
    // 先进行表单验证
    const isValid = await form.trigger()
    if (!isValid) {
      toast.error(t("toastFormInvalid"))
      return
    }

    const data = form.getValues()
    setIsSaving(true)

    try {
      await saveFn(data)
      const refreshed = await settingsQuery.refetch()
      if (refreshed.data) {
        form.reset(refreshed.data)
      }
      toast.success(t("toastSaveSuccess"))
      onSuccess?.()
    } catch (error) {
      const err = error as Error
      toast.error(
        t("toastSaveFailed", {
          message: err.message || t("errorUnknown"),
        })
      )
      onError?.(err)
    } finally {
      setIsSaving(false)
    }
  }

  return {
    form,
    isLoading: !isFormInitialized && !settingsQuery.error,
    isSaving,
    isDirty: form.formState.isDirty,
    handleSave,
    reset: () => form.reset(
      (settingsQuery.data ?? defaultValues) as DefaultValues<T> | T | undefined,
    ),
  }
}
