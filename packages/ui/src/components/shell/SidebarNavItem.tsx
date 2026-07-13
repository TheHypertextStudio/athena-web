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
 */
import * as React from 'react';

import type { LucideIcon } from '../../icons';
import { cn } from '../../lib/utils';
import { Button, focusRingInset } from '../../primitives';

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
  children,
}: SidebarNavItemProps): React.JSX.Element {
  const count = badge && badge > 0 ? badge : 0;
  const accessibleName = count > 0 ? `${label}, ${count} ${badgeLabel}` : label;
  // A dense, edge-to-edge sidebar row: `px-3 gap-2` matches the standard row rhythm, the label
  // reads at `text-body` (overriding Button `size="sm"`'s `text-xs`), and the inline glyph drops to
  // `size-3.5` (overriding the Button's baked-in `[&_svg]:size-4`) so it sits optically balanced
  // beside the label. `focusRingInset` swaps the Button's standalone 2px ring for the 1px inset
  // ring so adjacent flush rows never clip an overlapping outline.
  const className = cn(
    'w-full justify-start gap-2 px-3 text-body font-normal [&_svg]:size-3.5',
    active
      ? 'bg-secondary-container text-on-secondary-container'
      : 'text-on-surface-variant hover:text-on-surface',
    focusRingInset,
  );

  if (asChild) {
    return (
      <Button
        asChild
        variant="ghost"
        size="sm"
        aria-current={active ? 'page' : undefined}
        aria-label={count > 0 ? accessibleName : undefined}
        className={className}
      >
        {withBadge(children, count > 0 ? <NavBadge count={count} /> : null)}
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-current={active ? 'page' : undefined}
      aria-label={count > 0 ? accessibleName : undefined}
      onClick={onSelect}
      disabled={disabled}
      className={className}
    >
      {Icon ? <Icon aria-hidden="true" className="size-3.5 shrink-0" /> : null}
      <span className="truncate">{label}</span>
      {count > 0 ? <NavBadge count={count} /> : null}
    </Button>
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
