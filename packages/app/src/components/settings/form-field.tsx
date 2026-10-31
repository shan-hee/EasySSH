import * as React from "react"
import type { TFunction } from "i18next"
import type { FieldValues, Path, PathValue, UseFormReturn } from "react-hook-form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"

interface BaseFormFieldProps<TFieldValues extends FieldValues> {
  form: UseFormReturn<TFieldValues>
  name: Path<TFieldValues>
  label: string
  description?: React.ReactNode
  required?: boolean
  disabled?: boolean
  className?: string
}

interface FormInputProps<TFieldValues extends FieldValues> extends BaseFormFieldProps<TFieldValues> {
  type?: "text" | "number" | "email" | "url" | "password"
  placeholder?: string
  min?: number
  max?: number
  step?: number
}

interface FormSelectProps<TFieldValues extends FieldValues> extends BaseFormFieldProps<TFieldValues> {
  placeholder?: string
  options: Array<{ label: string; value: string }>
}

interface FormTextareaProps<TFieldValues extends FieldValues> extends BaseFormFieldProps<TFieldValues> {
  placeholder?: string
  rows?: number
}

function getTranslatedErrorMessage(t: TFunction, error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined
  }

  const rawMessage = "message" in error ? error.message : undefined
  if (typeof rawMessage !== "string") {
    return undefined
  }

  return rawMessage.startsWith("settingsValidation.")
    ? t(rawMessage.slice("settingsValidation.".length))
    : rawMessage
}

function useFieldError<TFieldValues extends FieldValues>(form: UseFormReturn<TFieldValues>, name: Path<TFieldValues>) {
  const { t } = useTranslation("settingsValidation")
  return getTranslatedErrorMessage(t, form.formState.errors[name])
}

/** Label above the control; help text and errors below it keep rows aligned in grids. */
function Field({ id, label, required, description, error, className, children }: {
  id: string
  label: string
  required?: boolean
  description?: React.ReactNode
  error?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && <Label htmlFor={id}>
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </Label>}
      {children}
      {error
        ? <p className="text-xs text-destructive">{error}</p>
        : description && <p className="text-xs text-muted-foreground">{description}</p>}
    </div>
  )
}

/**
 * 表单输入字段
 */
export function FormInput<TFieldValues extends FieldValues>({
  form,
  name,
  label,
  description,
  required,
  disabled,
  type = "text",
  placeholder,
  min,
  max,
  step,
  className,
}: FormInputProps<TFieldValues>) {
  const error = useFieldError(form, name)
  return (
    <Field id={name} label={label} required={required} description={description} error={error} className={className}>
      <Input
        id={name}
        type={type}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        // Stops browsers from filling saved sign-in passwords into service credentials.
        autoComplete={type === "password" ? "new-password" : undefined}
        aria-invalid={!!error}
        {...form.register(name, { valueAsNumber: type === "number" })}
      />
    </Field>
  )
}

/**
 * 表单开关字段
 */
export function FormSwitch<TFieldValues extends FieldValues>({
  form,
  name,
  label,
  description,
  disabled,
  className,
}: BaseFormFieldProps<TFieldValues>) {
  const value = form.watch(name)

  return (
    <div className={cn("flex items-center justify-between gap-4 rounded-lg border px-4 py-3", className)}>
      <div className="space-y-0.5">
        <Label htmlFor={name}>{label}</Label>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <Switch
        id={name}
        checked={!!value}
        disabled={disabled}
        onCheckedChange={(checked) => form.setValue(
          name,
          checked as PathValue<TFieldValues, Path<TFieldValues>>,
          { shouldDirty: true, shouldValidate: true },
        )}
      />
    </div>
  )
}

/**
 * 表单选择字段
 */
export function FormSelect<TFieldValues extends FieldValues>({
  form,
  name,
  label,
  description,
  required,
  disabled,
  placeholder,
  options,
  className,
}: FormSelectProps<TFieldValues>) {
  const error = useFieldError(form, name)
  const value = form.watch(name)

  return (
    <Field id={name} label={label} required={required} description={description} error={error} className={className}>
      <Select
        value={value}
        disabled={disabled}
        onValueChange={(val) => form.setValue(
          name,
          val as PathValue<TFieldValues, Path<TFieldValues>>,
          { shouldDirty: true, shouldValidate: true },
        )}
      >
        <SelectTrigger id={name} className="w-full" aria-invalid={!!error}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

/**
 * 表单文本域字段
 */
export function FormTextarea<TFieldValues extends FieldValues>({
  form,
  name,
  label,
  description,
  required,
  disabled,
  placeholder,
  rows = 3,
  className,
}: FormTextareaProps<TFieldValues>) {
  const error = useFieldError(form, name)
  return (
    <Field id={name} label={label} required={required} description={description} error={error} className={className}>
      <Textarea
        id={name}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        aria-invalid={!!error}
        {...form.register(name)}
      />
    </Field>
  )
}
