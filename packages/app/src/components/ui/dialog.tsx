import * as React from "react"
import { AnimatePresence, motion } from "motion/react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { XIcon } from "lucide-react"

import { ModalOpenContext, useModalMotion, useModalOpenState } from "./modal-motion"
import { cn } from "@/lib/utils"
import { useDialogSizeAnimation } from "@/hooks/use-dialog-size-animation"

function Dialog({
  open,
  defaultOpen,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  const state = useModalOpenState({ open, defaultOpen, onOpenChange })
  return (
    <ModalOpenContext.Provider value={state.open}>
      <DialogPrimitive.Root data-slot="dialog" {...props} {...state} />
    </ModalOpenContext.Provider>
  )
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  const animation = useModalMotion("overlay")
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/50",
        className
      )}
      {...props}
      asChild
    >
      <motion.div {...animation} />
    </DialogPrimitive.Overlay>
  )
}

/** Keep this shell mounted; Root.open lets Motion finish exiting before disposal. */
function DialogContent({
  ref,
  className,
  children,
  showCloseButton = true,
  onExitComplete,
  overlayClassName,
  containerClassName,
  dismissOnEscape = false,
  onEscapeKeyDown,
  onInteractOutside,
  onPointerDownOutside,
  onOpenAutoFocus,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  onExitComplete?: () => void
  overlayClassName?: string
  containerClassName?: string
  showCloseButton?: boolean
  dismissOnEscape?: boolean
}) {
  const contentRef = useDialogSizeAnimation(ref)
  const open = React.useContext(ModalOpenContext)
  const animation = useModalMotion()
  return (
    <AnimatePresence onExitComplete={onExitComplete}>
      {open && (
        <DialogPortal forceMount>
          <DialogOverlay forceMount className={overlayClassName} />
          <div className={cn("fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none", containerClassName)}>
            <DialogPrimitive.Content
              forceMount
              asChild
              ref={contentRef}
              data-slot="dialog-content"
              className={cn(
                "dialog-scrollbar-root bg-background pointer-events-auto data-[state=closed]:pointer-events-none relative grid w-full max-w-[calc(100%-2rem)] gap-4 rounded-lg border p-6 shadow-lg sm:max-w-lg",
                className
              )}
              onOpenAutoFocus={onOpenAutoFocus}
              onEscapeKeyDown={(event) => {
                onEscapeKeyDown?.(event)
                if (!dismissOnEscape) event.preventDefault()
              }}
              onInteractOutside={(event) => {
                onInteractOutside?.(event)
                event.preventDefault()
              }}
              onPointerDownOutside={(event) => {
                onPointerDownOutside?.(event)
                event.preventDefault()
              }}
              {...props}
            >
              <motion.div {...animation}>
                {children}
                {showCloseButton && (
                  <DialogPrimitive.Close
                    data-slot="dialog-close"
                    className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
                  >
                    <XIcon />
                    <span className="sr-only">Close</span>
                  </DialogPrimitive.Close>
                )}
              </motion.div>
            </DialogPrimitive.Content>
          </div>
        </DialogPortal>
      )}
    </AnimatePresence>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
