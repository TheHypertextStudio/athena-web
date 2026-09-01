/**
 * `@docket/ui` — Popover primitive (shadcn "new-york").
 *
 * @remarks
 * Hand-authored from the canonical shadcn "new-york" source over
 * `@radix-ui/react-popover`. Re-exports the unstyled passthrough roots
 * ({@link Popover}, {@link PopoverTrigger}, {@link PopoverAnchor}) and provides a
 * token-styled {@link PopoverContent} surface. Unlike {@link DropdownMenuContent}, a
 * popover does NOT trap typeahead or impose `menu`/`menuitem` roles, so it is the right
 * floating surface for a *searchable* picker whose body is a real text `<input>` plus a
 * roving `listbox`. All colors come from the semantic design tokens in
 * `@docket/ui/styles/globals.css`.
 */
import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as React from 'react';

import { cn } from '../lib/utils';
import { focusRing } from './focus';
import { type MenuWidth, menuContentClass } from './menu-styles';
import type { OverlayInset, PanelWidth, PopoverPresentation } from './overlay-contract';
import { OVERLAY_COLLISION_PADDING } from './overlay-inset';

/** Root controller for an open/closed popover (Radix passthrough). */
export const Popover = PopoverPrimitive.Root;

/** Element that toggles the popover open (Radix passthrough). */
export const PopoverTrigger = PopoverPrimitive.Trigger;

/** Minimal geometry contract accepted by Radix for virtual popover anchors. */
export interface PopoverVirtualAnchor {
  readonly getBoundingClientRect: () => DOMRect;
}

/** Standard nullable React ref used to position a popover from consumer-owned geometry. */
export type PopoverVirtualAnchorRef = React.RefObject<PopoverVirtualAnchor | null>;

type RadixPopoverAnchorProps = React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Anchor>;

/** Props for a positioning anchor decoupled from the popover trigger. */
export interface PopoverAnchorProps extends Omit<RadixPopoverAnchorProps, 'virtualRef'> {
  readonly virtualRef?: PopoverVirtualAnchorRef | undefined;
}

/** Optional positioning anchor decoupled from the trigger. */
export const PopoverAnchor = React.forwardRef<HTMLDivElement, PopoverAnchorProps>(
  ({ virtualRef, ...props }, forwardedRef) => (
    <PopoverPrimitive.Anchor
      {...props}
      ref={forwardedRef}
      {...(virtualRef !== undefined ? { virtualRef } : {})}
    />
  ),
);
PopoverAnchor.displayName = PopoverPrimitive.Anchor.displayName;

/**
 * Floating panel that holds the popover body; rendered through a portal.
 *
 * @remarks
 * Renders {@link DropdownMenuContent}'s exact surface — same `menuContentClass`, so the same
 * 16dp corner, 4dp padding, `level2` elevation, motion, and submenu shape morphing — as a plain
 * region with no `menu` semantics, so it can host arbitrary interactive content. Defaults to
 * `align="start"` so a property picker's panel left-edge lines up with its compact trigger
 * rather than centering under it.
 *
 * Every searchable picker in the product is a menu wearing a popover, so the surface comes from
 * one string and this overrides only what is popover-specific.
 *
 * Layering: transient overlays (this, dropdown/context menus, tooltips, hover cards) sit at
 * `z-[120]` — above the modal layer (sheets `z-[100]`, dialogs `z-[110]`) — so a picker opened
 * from inside a dialog renders over it instead of behind the scrim.
 */
const PANEL_WIDTH: Readonly<Record<PanelWidth, string>> = {
  sm: 'w-48',
  md: 'w-56',
  lg: 'w-72',
  xl: 'w-88',
  wide: 'w-[28rem]',
  content: 'w-auto',
};

function isMenuWidth(width: MenuWidth | PanelWidth): width is MenuWidth {
  return width === 'sm' || width === 'md' || width === 'lg' || width === 'xl';
}

/** Props for {@link PopoverContent}. */
export interface PopoverContentProps extends Omit<
  React.ComponentProps<typeof PopoverPrimitive.Content>,
  'className'
> {
  /** Select a menu surface or a general-purpose floating panel. */
  readonly presentation?: PopoverPresentation | undefined;
  /** Width tier for the selected presentation. */
  readonly width?: MenuWidth | PanelWidth | undefined;
  /** Compatibility escape hatch while existing panels migrate to named slots. */
  readonly className?: string | undefined;
}

/** Render a menu or floating panel with shared collision and width rules. */
export function PopoverContent({
  className,
  align = 'start',
  sideOffset = 4,
  collisionPadding = OVERLAY_COLLISION_PADDING,
  presentation = 'menu',
  width = 'md',
  ...props
}: PopoverContentProps): React.JSX.Element {
  const isMenu = presentation === 'menu';
  const surfaceClass = isMenu
    ? menuContentClass('standard', isMenuWidth(width) ? width : 'md')
    : cn(
        'bg-surface-container-high text-on-surface shadow-level2 flex min-h-0 max-w-[calc(100vw-1.5rem)] flex-col gap-0 overflow-hidden rounded-corner-lg p-0',
        PANEL_WIDTH[width],
      );
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          surfaceClass,
          'pointer-events-auto z-[120] max-h-[var(--radix-popover-content-available-height)] min-h-0 origin-[var(--radix-popover-content-transform-origin)] outline-none',
          isMenu && 'overflow-x-hidden overflow-y-auto',
          focusRing,
          className,
        )}
        data-surface-tone={isMenu ? 'floating' : 'floating'}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

/** Fixed header region that shares the popover body's horizontal inset. */
export function PopoverHeader({
  className,
  inset = 'compact',
  ...props
}: React.ComponentProps<'div'> & { readonly inset?: OverlayInset | undefined }): React.JSX.Element {
  return (
    <div
      className={cn('flex shrink-0 flex-col gap-1.5', overlayInsetClass(inset), className)}
      {...props}
    />
  );
}

/** The only panel-popover region permitted to own vertical overflow. */
export function PopoverBody({
  className,
  inset = 'compact',
  scroll = 'auto',
  ...props
}: React.ComponentProps<'div'> & {
  readonly inset?: OverlayInset | undefined;
  readonly scroll?: 'auto' | 'visible' | undefined;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'min-h-0 flex-1',
        overlayInsetClass(inset),
        scroll === 'auto' && 'overflow-y-auto overscroll-contain',
        className,
      )}
      {...(scroll === 'auto' ? { 'data-overlay-scroll-owner': '' } : {})}
      {...props}
    />
  );
}

/** Fixed action region that shares the popover body's horizontal inset. */
export function PopoverFooter({
  className,
  inset = 'compact',
  ...props
}: React.ComponentProps<'div'> & { readonly inset?: OverlayInset | undefined }): React.JSX.Element {
  return (
    <div
      className={cn('flex shrink-0 items-center gap-2', overlayInsetClass(inset), className)}
      {...props}
    />
  );
}

function overlayInsetClass(inset: OverlayInset): string {
  if (inset === 'none') return '';
  if (inset === 'compact') return 'px-4 py-3';
  return 'px-6 py-4';
}
