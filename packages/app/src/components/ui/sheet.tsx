import * as React from "react"
import { AnimatePresence, motion } from "motion/react"
import * as SheetPrimitive from "@radix-ui/react-dialog"
import { XIcon } from "lucide-react"

import { ModalOpenContext, useModalMotion, useModalOpenState } from "./modal-motion"
import { cn } from "@/lib/utils"

function Sheet({
  open,
  defaultOpen,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Root>) {
  const state = useModalOpenState({ open, defaultOpen, onOpenChange })
  return (
    <ModalOpenContext.Provider value={state.open}>
      <SheetPrimitive.Root data-slot="sheet" {...props} {...state} />
    </ModalOpenContext.Provider>
  )
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  const animation = useModalMotion("overlay")
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/50",
        className
      )}
      {...props}
      asChild
    >
      <motion.div {...animation} />
    </SheetPrimitive.Overlay>
  )
}

function SheetContent({
  className,
  children,
  side = "right",
  showOverlay = true,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
  showOverlay?: boolean
  showCloseButton?: boolean
}) {
  const open = React.useContext(ModalOpenContext)
  const animation = useModalMotion(side)
  return (
    <AnimatePresence>
      {open && (
        <SheetPortal forceMount>
          {showOverlay && <SheetOverlay forceMount />}
          <SheetPrimitive.Content
            forceMount
            asChild
            data-slot="sheet-content"
            className={cn(
              "bg-background data-[state=closed]:pointer-events-none fixed z-50 flex flex-col gap-4 shadow-lg",
              side === "right" &&
                "inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm",
              side === "left" &&
                "inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm",
              side === "top" &&
                "inset-x-0 top-0 h-auto border-b",
              side === "bottom" &&
                "inset-x-0 bottom-0 h-auto border-t",
              className
            )}
            {...props}
          >
            <motion.div {...animation}>
              {children}
              {showCloseButton && (
                <SheetPrimitive.Close className="ring-offset-background focus:ring-ring data-[state=open]:bg-secondary absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none">
                  <XIcon className="size-4" />
                  <span className="sr-only">Close</span>
                </SheetPrimitive.Close>
              )}
            </motion.div>
          </SheetPrimitive.Content>
        </SheetPortal>
      )}
    </AnimatePresence>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1.5 p-4", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-foreground font-semibold", className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
