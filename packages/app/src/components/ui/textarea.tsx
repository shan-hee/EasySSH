import * as React from "react"

import { cn } from "@/lib/utils"
import {
  formControlBaseClassName,
  formControlFocusClassName,
  formControlInvalidClassName,
} from "@/components/ui/form-control"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "placeholder:text-muted-foreground flex field-sizing-content min-h-16 w-full rounded-md border px-3 py-2 text-base md:text-sm",
        formControlBaseClassName,
        formControlFocusClassName,
        formControlInvalidClassName,
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
