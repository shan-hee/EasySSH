"use client"

import { memo, useRef, type ComponentPropsWithoutRef, type FC } from "react"
import {
  ComposerPrimitive,
  unstable_defaultDirectiveFormatter,
  unstable_useTriggerPopoverScopeContext,
  type Unstable_DirectiveFormatter,
  type Unstable_TriggerItem
} from "@assistant-ui/react"
import { ChevronLeftIcon, ChevronRightIcon, CornerDownLeftIcon, SparklesIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { useSynchronousSelectedItemScroll } from "@/hooks/use-synchronous-selected-item-scroll"

type IconComponent = FC<{ className?: string }>

type DirectiveBehaviorProps = {
  /** Formatter used to serialize the selected item into composer text. */
  formatter?: Unstable_DirectiveFormatter | undefined
  /** Called after the directive text has been inserted into the composer. */
  onInserted?: ((item: Unstable_TriggerItem) => void) | undefined
}

type ActionBehaviorProps = {
  /** Formatter used to serialize the audit-trail chip (when `removeOnExecute` is false). */
  formatter?: Unstable_DirectiveFormatter | undefined
  /** Invoked with the selected item at the moment of selection. */
  onExecute: (item: Unstable_TriggerItem) => void
  /** If `true`, strip the trigger text from the composer after executing. @default false */
  removeOnExecute?: boolean | undefined
}

type ComposerTriggerPopoverBaseProps = Omit<
  ComponentPropsWithoutRef<typeof ComposerPrimitive.Unstable_TriggerPopover>,
  "children"
> & {
  /**
   * Maps icon keys to components. Items look up via `item.metadata?.icon`
   * (string); categories look up via their `id`.
   */
  iconMap?: Record<string, IconComponent>
  /** Fallback icon when no entry in `iconMap` matches. */
  fallbackIcon?: IconComponent
  /** Label shown on the back button. @default "Back" */
  backLabel?: string
  /** Label shown when no categories are available. @default "No items available" */
  emptyCategoriesLabel?: string
  /** Label shown when no items match. @default "No matching items" */
  emptyItemsLabel?: string
  /** Label shown while an async adapter is resolving items. @default "Loading…" */
  loadingLabel?: string
  /** Heading and keyboard guidance for the item list. */
  label?: string
  navigationHint?: string
}

type ComposerTriggerPopoverProps = ComposerTriggerPopoverBaseProps &
  (
    | {
        /** Insert-directive behavior. */
        directive: DirectiveBehaviorProps
        action?: never
      }
    | {
        /** Action behavior. */
        action: ActionBehaviorProps
        directive?: never
      }
  )

function resolveIcon(
  iconKey: string | undefined,
  iconMap: Record<string, IconComponent> | undefined,
  fallback: IconComponent
): IconComponent {
  if (iconKey && iconMap?.[iconKey]) return iconMap[iconKey]!
  return fallback
}

type CategoriesProps = {
  iconMap: Record<string, IconComponent> | undefined
  fallbackIcon: IconComponent
  emptyLabel: string
}

const Categories: FC<CategoriesProps> = ({ iconMap, fallbackIcon, emptyLabel }) => {
  const { open, activeCategoryId, isSearchMode, highlightedItemId } = unstable_useTriggerPopoverScopeContext()
  const listRef = useRef<HTMLDivElement>(null)
  useSynchronousSelectedItemScroll({
    enabled: open && !activeCategoryId && !isSearchMode,
    listRef,
    selectedKey: highlightedItemId,
  })

  return (
    <ComposerPrimitive.Unstable_TriggerPopoverCategories>
      {(categories) => (
        <div ref={listRef} data-slot="composer-trigger-popover-categories" className="scrollbar-custom flex max-h-[min(18rem,40dvh)] flex-col overflow-y-auto overscroll-contain scroll-auto [overflow-anchor:none] p-1">
          {categories.map((cat) => {
            const Icon = resolveIcon(cat.id, iconMap, fallbackIcon)
            return (
              <ComposerPrimitive.Unstable_TriggerPopoverCategoryItem
                key={cat.id}
                categoryId={cat.id}
                className="data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring flex shrink-0 cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 py-2 text-sm outline-none"
              >
                <span className="flex items-center gap-2">
                  <Icon className="text-muted-foreground size-4" />
                  {cat.label}
                </span>
                <ChevronRightIcon className="text-muted-foreground size-4" />
              </ComposerPrimitive.Unstable_TriggerPopoverCategoryItem>
            )
          })}
          {categories.length === 0 && (
            <div className="text-muted-foreground px-3 py-2 text-sm">{emptyLabel}</div>
          )}
        </div>
      )}
    </ComposerPrimitive.Unstable_TriggerPopoverCategories>
  )
}

type ItemsProps = {
  iconMap: Record<string, IconComponent> | undefined
  fallbackIcon: IconComponent
  backLabel: string
  emptyLabel: string
  loadingLabel: string
  label?: string
  navigationHint?: string
}

const Items: FC<ItemsProps> = ({ iconMap, fallbackIcon, backLabel, emptyLabel, loadingLabel, label, navigationHint }) => {
  const { isLoading, highlightedItemId, open, activeCategoryId, isSearchMode } = unstable_useTriggerPopoverScopeContext()
  const listRef = useRef<HTMLDivElement>(null)

  useSynchronousSelectedItemScroll({
    enabled: open && (isSearchMode || activeCategoryId !== null),
    listRef,
    selectedKey: highlightedItemId,
  })

  return (
    <ComposerPrimitive.Unstable_TriggerPopoverItems aria-label={label}>
      {(items) => (
        <div data-slot="composer-trigger-popover-items" className="flex flex-col">
          {label && (
            <div className="flex items-center justify-between gap-2 px-3 pb-1 pt-2.5 text-xs text-muted-foreground">
              <span>{label}</span>
              {!isLoading && <span className="tabular-nums">{items.length}</span>}
            </div>
          )}
          <ComposerPrimitive.Unstable_TriggerPopoverBack className="text-muted-foreground hover:bg-accent flex cursor-pointer items-center gap-1.5 border-b px-3 py-2 text-xs tracking-wide uppercase transition-colors">
            <ChevronLeftIcon className="size-3.5" />
            {backLabel}
          </ComposerPrimitive.Unstable_TriggerPopoverBack>

          <div ref={listRef} className="scrollbar-custom max-h-[min(15rem,32dvh)] overflow-y-auto overscroll-contain scroll-auto [overflow-anchor:none] p-1">
            {items.map((item, index) => {
              const iconKey = typeof item.metadata?.icon === "string" ? item.metadata.icon : undefined
              const Icon = resolveIcon(iconKey, iconMap, fallbackIcon)
              return (
                <ComposerPrimitive.Unstable_TriggerPopoverItem
                  key={item.id}
                  item={item}
                  index={index}
                  className="group/trigger-item data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-start outline-none"
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground group-data-[highlighted]/trigger-item:text-accent-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium" title={item.label}>{item.label}</span>
                    {item.description && (
                      <span className="mt-0.5 block truncate text-xs leading-4 text-muted-foreground" title={item.description}>
                        {item.description}
                      </span>
                    )}
                  </span>
                  <CornerDownLeftIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground opacity-0 group-data-[highlighted]/trigger-item:opacity-100" />
                </ComposerPrimitive.Unstable_TriggerPopoverItem>
              )
            })}
            {items.length === 0 && (
              <div role="status" className="px-3 py-5 text-center text-sm text-muted-foreground">
                {isLoading ? loadingLabel : emptyLabel}
              </div>
            )}
          </div>
          {navigationHint && items.length > 0 && (
            <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">{navigationHint}</div>
          )}
        </div>
      )}
    </ComposerPrimitive.Unstable_TriggerPopoverItems>
  )
}

/**
 * Pre-built popover UI for a trigger-driven picker (mentions, slash commands, etc).
 * Pass exactly one of `directive` (inserts a chip) or `action` (fires a handler).
 */
const ComposerTriggerPopoverImpl: FC<ComposerTriggerPopoverProps> = ({
  iconMap,
  fallbackIcon = SparklesIcon,
  backLabel = "Back",
  emptyCategoriesLabel = "No items available",
  emptyItemsLabel = "No matching items",
  loadingLabel = "Loading…",
  label,
  navigationHint,
  className,
  directive,
  action,
  ...props
}) => {
  const warnedRef = useRef(false)
  if (process.env.NODE_ENV !== "production" && !warnedRef.current && Boolean(directive) === Boolean(action)) {
    warnedRef.current = true
    console.warn(
      "[assistant-ui] ComposerTriggerPopover requires exactly one of `directive` or `action` props."
    )
  }

  return (
    <ComposerPrimitive.Unstable_TriggerPopover
      data-slot="composer-trigger-popover"
      className={cn(
        "aui-composer-trigger-popover bg-popover text-popover-foreground absolute start-0 bottom-full z-50 mb-2 w-80 max-w-full overflow-hidden rounded-xl border border-border shadow-md",
        className
      )}
      {...props}
    >
      {directive ? (
        <ComposerPrimitive.Unstable_TriggerPopover.Directive
          formatter={directive.formatter ?? unstable_defaultDirectiveFormatter}
          onInserted={directive.onInserted}
        />
      ) : action ? (
        <ComposerPrimitive.Unstable_TriggerPopover.Action
          formatter={action.formatter ?? unstable_defaultDirectiveFormatter}
          onExecute={action.onExecute}
          removeOnExecute={action.removeOnExecute}
        />
      ) : null}
      <Categories iconMap={iconMap} fallbackIcon={fallbackIcon} emptyLabel={emptyCategoriesLabel} />
      <Items
        iconMap={iconMap}
        fallbackIcon={fallbackIcon}
        backLabel={backLabel}
        emptyLabel={emptyItemsLabel}
        loadingLabel={loadingLabel}
        label={label}
        navigationHint={navigationHint}
      />
    </ComposerPrimitive.Unstable_TriggerPopover>
  )
}
ComposerTriggerPopoverImpl.displayName = "ComposerTriggerPopover"

export const ComposerTriggerPopover = memo(ComposerTriggerPopoverImpl) as FC<ComposerTriggerPopoverProps>
