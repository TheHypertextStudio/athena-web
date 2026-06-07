'use client';

/**
 * `@docket/ui` — a single nav row in the {@link ContextSidebar}.
 *
 * @remarks
 * Renders a label with an optional leading icon as a button (or, via `asChild`, onto a
 * custom link element so the host app's router can own navigation). The label is supplied
 * by the {@link ContextSidebar}, which resolves entity nouns through `useVocabulary` — this
 * component never hardcodes entity labels itself.
 */
import * as React from 'react';

import type { LucideIcon } from '../../icons';
import { cn } from '../../lib/utils';
import { Button } from '../../primitives';

/** Props for {@link SidebarNavItem}. */
export interface SidebarNavItemProps {
  /** The resolved, display-ready label for this nav row. */
  label: string;
  /** Optional leading icon component. */
  icon?: LucideIcon;
  /** Whether this row is the active route. */
  active?: boolean;
  /**
   * When `true`, render the row styling onto the single child element (e.g. a router
   * `Link`) instead of a native `<button>`.
   */
  asChild?: boolean;
  /** Click handler used when not rendering `asChild`. */
  onSelect?: () => void;
  /** The child element to style when `asChild` is set. */
  children?: React.ReactNode;
}

/**
 * A nav row for the org-scoped {@link ContextSidebar}.
 *
 * @remarks
 * Pass `asChild` with a routing `Link` child to let the host app own navigation; otherwise
 * the row behaves as a button and calls `onSelect`.
 */
export function SidebarNavItem({
  label,
  icon: Icon,
  active = false,
  asChild = false,
  onSelect,
  children,
}: SidebarNavItemProps): React.JSX.Element {
  const className = cn(
    'w-full justify-start gap-2 px-2 font-normal',
    active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground',
  );

  if (asChild) {
    return (
      <Button
        asChild
        variant="ghost"
        size="sm"
        aria-current={active ? 'page' : undefined}
        className={className}
      >
        {children}
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-current={active ? 'page' : undefined}
      onClick={onSelect}
      className={className}
    >
      {Icon ? <Icon aria-hidden="true" /> : null}
      <span>{label}</span>
    </Button>
  );
}
