'use client';

/**
 * `@docket/ui` — a single nav row in the {@link Sidebar}.
 *
 * @remarks
 * Renders a label with an optional leading icon as a button (or, via `asChild`, onto a
 * custom link element so the host app's router can own navigation). The label is supplied by
 * the {@link Sidebar}, which resolves entity nouns through `useVocabulary` — this component
 * never hardcodes entity labels itself. An optional attention `badge` is rendered as a small
 * trailing count pill and folded into the accessible name (e.g. "Inbox, 3 unread").
 *
 * When `asChild` is set, the caller supplies the row's leading-icon + label content as
 * `children` (rendered inside the link). The badge, when present, is appended after that
 * content so a single `asChild` row can still surface an attention count.
 *
 * `collapsed` turns the row into a square glyph. The label does not disappear — it moves into a
 * tooltip and stays the row's accessible name, so the nav is exactly as navigable by name as it was
 * when the words were on screen.
 */
import * as React from 'react';

import type { LucideIcon } from '../../icons';
import { cn } from '../../lib/utils';
import { Button, focusRingInset, Tooltip, TooltipContent, TooltipTrigger } from '../../primitives';

/** Props for {@link SidebarNavItem}. */
export interface SidebarNavItemProps {
  /** The resolved, display-ready label for this nav row. */
  label: string;
  /** Optional leading icon component (ignored when `asChild`, where `children` owns content). */
  icon?: LucideIcon;
  /** Whether this row is the active route. */
  active?: boolean;
  /**
   * An attention count to surface as a trailing pill. When `> 0` a count is shown and folded
   * into the accessible name; `0`/`undefined` shows nothing.
   */
  badge?: number;
  /** A type-specific suffix for the badge's accessible name (default `unread`). */
  badgeLabel?: string;
  /**
   * When `true`, render the row styling onto the single child element (e.g. a router
   * `Link`) instead of a native `<button>`.
   */
  asChild?: boolean;
  /** Click handler used when not rendering `asChild`. */
  onSelect?: () => void;
  /** Disable a button-backed row while its action is unavailable. */
  disabled?: boolean;
  /** Render as a square icon-only glyph, with the label moved into a tooltip. */
  collapsed?: boolean;
  /** The child element to style when `asChild` is set. */
  children?: React.ReactNode;
}

/** Clamp a raw attention count to a compact label (`99+` ceiling). */
function badgeText(count: number): string {
  return count > 99 ? '99+' : String(count);
}

/** A small trailing attention pill, hidden from the a11y tree (the name carries the count). */
function NavBadge({ count }: { readonly count: number }): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="bg-surface-container-highest text-on-surface-variant ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] leading-none font-semibold tabular-nums"
    >
      {badgeText(count)}
    </span>
  );
}

/**
 * A nav row for the {@link Sidebar}.
 *
 * @remarks
 * Pass `asChild` with a routing `Link` child to let the host app own navigation; otherwise
 * the row behaves as a button and calls `onSelect`.
 */
export function SidebarNavItem({
  label,
  icon: Icon,
  active = false,
  badge,
  badgeLabel = 'unread',
  asChild = false,
  onSelect,
  disabled = false,
  collapsed = false,
  children,
}: SidebarNavItemProps): React.JSX.Element {
  const count = badge && badge > 0 ? badge : 0;
  const accessibleName = count > 0 ? `${label}, ${count} ${badgeLabel}` : label;
  // A dense, edge-to-edge sidebar row: `px-3 gap-2` matches the standard row rhythm, the label
  // reads at `text-body-large` (one step up the MD3 body scale from the row-title default
  // `body-medium`, overriding Button `size="sm"`'s `text-xs`), and the inline glyph drops to
  // `size-4` (overriding the Button's baked-in `[&_svg]:size-4`) so it sits optically balanced
  // beside the label. `focusRingInset` swaps the Button's standalone 2px ring for the 1px inset
  // ring so adjacent flush rows never clip an overlapping outline.
  const className = cn(
    'text-body-large font-normal [&_svg]:size-4',
    // Collapsed the row is a square the glyph sits in the middle of; expanded it is the full-width
    // label row. `[&>span:last-child]:hidden` is what hides an `asChild` link's label without the
    // caller having to know it is collapsed — the link content is the host's, not this file's.
    collapsed
      ? 'size-10 justify-center px-0 [&>span:last-child]:hidden'
      : 'w-full justify-start gap-2 px-3',
    active
      ? 'bg-secondary-container text-on-secondary-container'
      : 'text-on-surface-variant hover:text-on-surface',
    focusRingInset,
  );

  // Collapsed, the label is no longer on screen, so it has to be the accessible name outright
  // rather than only when a badge forces the issue.
  const ariaLabel = collapsed || count > 0 ? accessibleName : undefined;

  const row = asChild ? (
    <Button
      asChild
      variant="ghost"
      size="sm"
      aria-current={active ? 'page' : undefined}
      aria-label={ariaLabel}
      className={className}
    >
      {withBadge(children, count > 0 && !collapsed ? <NavBadge count={count} /> : null)}
    </Button>
  ) : (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-current={active ? 'page' : undefined}
      aria-label={ariaLabel}
      onClick={onSelect}
      disabled={disabled}
      className={className}
    >
      {Icon ? <Icon aria-hidden="true" className="size-4 shrink-0" /> : null}
      {collapsed ? null : <span className="truncate">{label}</span>}
      {count > 0 && !collapsed ? <NavBadge count={count} /> : null}
    </Button>
  );

  if (!collapsed) return row;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{row}</TooltipTrigger>
      <TooltipContent side="right">{accessibleName}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Append an optional trailing `badge` inside the row's `children` link element, returning a
 * single element for the `asChild` `Slot`.
 *
 * @remarks
 * Radix's `Slot` (used by `Button asChild`) requires exactly one child element and merges the
 * Button's styling + a11y props (`className`, `aria-current`, `aria-label`) onto it. We clone
 * that element to append the badge after its existing content, so the link stays the single
 * styled child the Slot needs while still carrying its attention pill. When there is no badge
 * (or the child is not an element), the child is returned unchanged.
 */
function withBadge(children: React.ReactNode, badge: React.ReactNode): React.ReactNode {
  if (!badge || !React.isValidElement(children)) {
    return children;
  }
  const element = children as React.ReactElement<{ children?: React.ReactNode }>;
  return React.cloneElement(
    element,
    undefined,
    <>
      {element.props.children}
      {badge}
    </>,
  );
}
