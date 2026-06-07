'use client';

/**
 * `@docket/ui` — a Hub-level destination button for the {@link GlobalRail}.
 *
 * @remarks
 * The rail's top cluster holds the cross-org Hub destinations (Today, Inbox, Portfolio,
 * Search). Each is a circular icon {@link Button} that mirrors the Hub button's visual
 * language: the active destination renders the `secondary` variant + `aria-current="page"`,
 * the rest stay `ghost`. An optional attention `badge` (e.g. the unread inbox count) floats
 * at the top-right as a small, accessible count pill so the rail surfaces what needs the
 * caller's attention without leaving the Hub.
 */
import * as React from 'react';

import type { LucideIcon } from '../../icons';
import { cn } from '../../lib/utils';
import { Button } from '../../primitives';

/** Props for {@link RailNavButton}. */
export interface RailNavButtonProps {
  /** The glyph for the destination. */
  icon: LucideIcon;
  /** Accessible label + tooltip for the icon-only button. */
  label: string;
  /** Whether this destination is the active route (renders the `secondary` look). */
  active?: boolean;
  /**
   * An attention count to surface as a corner badge. When `> 0` a count pill is shown and
   * folded into the accessible name (e.g. "Inbox, 3 unread"); `0`/`undefined` shows nothing.
   */
  badge?: number;
  /** A longer, type-specific suffix for the badge's accessible name (default `unread`). */
  badgeLabel?: string;
  /** Invoked when the destination is selected. */
  onSelect: () => void;
}

/** Clamp a raw attention count to a compact, rail-friendly label (`99+` ceiling). */
function badgeText(count: number): string {
  return count > 99 ? '99+' : String(count);
}

/**
 * A circular Hub-destination button for the {@link GlobalRail}, with an optional count badge.
 *
 * @remarks
 * Icon-only by design (the rail is 64px wide), so the human-readable `label` is carried on
 * both `aria-label` and the native `title` tooltip. When a `badge` count is present it is
 * appended to the accessible name and rendered as a small overlapping pill.
 */
export function RailNavButton({
  icon: Icon,
  label,
  active = false,
  badge,
  badgeLabel = 'unread',
  onSelect,
}: RailNavButtonProps): React.JSX.Element {
  const count = badge && badge > 0 ? badge : 0;
  const accessibleName = count > 0 ? `${label}, ${count} ${badgeLabel}` : label;

  return (
    <div className="relative">
      <Button
        type="button"
        variant={active ? 'secondary' : 'ghost'}
        size="icon"
        aria-label={accessibleName}
        aria-current={active ? 'page' : undefined}
        title={label}
        onClick={onSelect}
        className={cn('h-9 w-9 rounded-full', active && 'text-foreground')}
      >
        <Icon aria-hidden="true" />
      </Button>
      {count > 0 ? (
        <span
          aria-hidden="true"
          className="bg-primary text-primary-foreground ring-card pointer-events-none absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold tabular-nums ring-2"
        >
          {badgeText(count)}
        </span>
      ) : null}
    </div>
  );
}
