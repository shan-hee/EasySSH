import * as React from "react"
import { AnimatePresence, motion } from "motion/react"
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog"

import { ModalOpenContext, useModalMotion, useModalOpenState } from "./modal-motion"
import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"
import { useDialogSizeAnimation } from "@/hooks/use-dialog-size-animation"

function AlertDialog({
  open,
  defaultOpen,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  const state = useModalOpenState({ open, defaultOpen, onOpenChange })
  return (
    <ModalOpenContext.Provider value={state.open}>
      <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} {...state} />
    </ModalOpenContext.Provider>
  )
}

function AlertDialogTrigger({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
  return (
    <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
  )
}

function AlertDialogPortal({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Portal>) {
  return (
    <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
  )
}

function AlertDialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>) {
  const animation = useModalMotion("overlay")
  return (
    <AlertDialogPrimitive.Overlay
      data-slot="alert-dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/50",
        className
      )}
      {...props}
      asChild
    >
      <motion.div {...animation} />
    </AlertDialogPrimitive.Overlay>
  )
}

function AlertDialogContent({
  ref,
  children,
  overlayClassName,
  containerClassName,
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content> & {
  overlayClassName?: string
  containerClassName?: string
}) {
  const contentRef = useDialogSizeAnimation(ref)
  const open = React.useContext(ModalOpenContext)
  const animation = useModalMotion()
  return (
    <AnimatePresence>
      {open && (
        <AlertDialogPortal forceMount>
          <AlertDialogOverlay forceMount className={overlayClassName} />
          <div className={cn("fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none", containerClassName)}>
            <AlertDialogPrimitive.Content
              forceMount
              asChild
              ref={contentRef}
              data-slot="alert-dialog-content"
              className={cn(
                "dialog-scrollbar-root bg-background pointer-events-auto data-[state=closed]:pointer-events-none relative grid w-full max-w-[calc(100%-2rem)] gap-4 rounded-lg border p-6 shadow-lg sm:max-w-lg",
                className
              )}
              {...props}
            >
              <motion.div {...animation}>{children}</motion.div>
            </AlertDialogPrimitive.Content>
          </div>
        </AlertDialogPortal>
      )}
    </AnimatePresence>
  )
}

function AlertDialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function AlertDialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn("text-lg font-semibold", className)}
      {...props}
    />
  )
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

function AlertDialogAction({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action>) {
  return (
    <AlertDialogPrimitive.Action
      className={cn(buttonVariants(), className)}
      {...props}
    />
  )
}

function AlertDialogCancel({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  return (
    <AlertDialogPrimitive.Cancel
      className={cn(buttonVariants({ variant: "outline" }), className)}
      {...props}
    />
  )
}

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
}
