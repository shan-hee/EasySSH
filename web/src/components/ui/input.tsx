import * as React from "react"

import { cn } from "@/lib/utils"
import {
  formControlBaseClassName,
  formControlFocusClassName,
  formControlInvalidClassName,
} from "@/components/ui/form-control"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground h-9 w-full min-w-0 rounded-md border px-3 py-1 text-base file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none md:text-sm",
        formControlBaseClassName,
        formControlFocusClassName,
        formControlInvalidClassName,
        className
      )}
      {...props}
    />
  )
}

export { Input }
