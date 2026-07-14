'use client';

/**
 * The collapsible stats banner atop the cycle detail screen.
 *
 * @remarks
 * The "are we on pace?" header for a cycle (product §8.5). Expanded, it shows the
 * {@link BurnupChart} (planned vs completed effort over the window) plus a row of stat
 * tiles — committed/completed task counts, capacity (planned vs done points), scope that
 * crept in mid-cycle, and carryover (still-open work) — and a runway line for the window's
 * elapsed/remaining days. Collapsed, it folds to a single dense summary strip so the task
 * list below can take the full height. The collapse control is a real disclosure button
 * (`aria-expanded` + `aria-controls`) so the region is keyboard-operable and screen-reader
 * announced.
 *
 * Everything is rendered with `@docket/ui` primitives and semantic tokens — no bare HTML
 * controls, no hardcoded color.
 */
import type { CycleBurnupOut } from '@docket/types';
import { ChevronDown, ChevronRight } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import type { JSX } from 'react';

import { BurnupChart } from './burnup-chart';
import type { WindowProgress } from './format-window';

/** Props for {@link StatsBanner}. */
export interface StatsBannerProps {
  /** The cycle's burn-up report (series + rolled-up stats). */
  burnup: CycleBurnupOut;
  /** The window's live progress (drives the runway line + chart marker). */
  window: WindowProgress;
  /** Whether the banner is expanded. */
  expanded: boolean;
  /** Toggle the banner's expanded state. */
  onToggleExpanded: () => void;
  /** The (vocabulary-resolved) singular cycle noun, lowercased for inline copy. */
  cycleNoun: string;
}

/** A single labeled metric tile within the banner's stat grid. */
function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'warning';
}): JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-on-surface-variant text-xs font-medium">{label}</dt>
      <dd
        className={cn(
          'text-on-surface text-lg font-semibold tabular-nums',
          tone === 'warning' && 'text-state-started',
        )}
      >
        {value}
      </dd>
      {hint ? <p className="text-on-surface-variant text-xs">{hint}</p> : null}
    </div>
  );
}

/**
 * The cycle detail's collapsible pace banner.
 *
 * @example
 * ```tsx
 * <StatsBanner burnup={burnup} window={win} expanded={open} onToggleExpanded={toggle} cycleNoun="cycle" />
 * ```
 */
export function StatsBanner({
  burnup,
  window,
  expanded,
  onToggleExpanded,
  cycleNoun,
}: StatsBannerProps): JSX.Element {
  const { stats } = burnup;
  const pacePct =
    stats.capacity === 0 ? 0 : Math.round((stats.completedCapacity / stats.capacity) * 100);

  const runway = window.notStarted
    ? `Starts in ${String(window.remainingDays)} ${window.remainingDays === 1 ? 'day' : 'days'}`
    : window.ended
      ? `Window closed · ran ${String(window.totalDays)} ${window.totalDays === 1 ? 'day' : 'days'}`
      : `Day ${String(window.elapsedDays)} of ${String(window.totalDays)} · ${String(
          window.remainingDays,
        )} ${window.remainingDays === 1 ? 'day' : 'days'} left`;

  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <section
      aria-label={`${cycleNoun} pace`}
      className="border-outline-variant bg-surface-container-low overflow-hidden rounded-xl border"
    >
      <button
        type="button"
        onClick={onToggleExpanded}
        aria-expanded={expanded}
        aria-controls="cycle-stats-body"
        className={cn(
          'focus-visible:ring-ring flex w-full items-center gap-3 px-4 py-3 text-left outline-none',
          'hover:bg-surface-container-high transition-colors focus-visible:ring-1 focus-visible:ring-inset',
        )}
      >
        <Chevron aria-hidden="true" className="text-on-surface-variant h-4 w-4 shrink-0" />
        <span className="text-on-surface text-body-medium font-semibold">Pace</span>
        {/* The runway phrase is supplementary; hide it on the narrowest panels so the
            headline numbers never collide with it. */}
        <span className="text-on-surface-variant hidden text-xs @2xl:inline">{runway}</span>
        {/* Collapsed summary strip: the headline numbers stay visible when folded. It can wrap
            below the label on narrow panels rather than force horizontal overflow. */}
        <span className="text-on-surface-variant ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs tabular-nums">
          <span>
            <span className="text-on-surface font-medium">{stats.completed}</span>/{stats.committed}{' '}
            done
          </span>
          <span
            aria-hidden="true"
            className="bg-outline-variant hidden h-3 w-px @2xl:inline-block"
          />
          <span>{pacePct}% of capacity</span>
          {stats.carryover > 0 ? (
            <>
              <span
                aria-hidden="true"
                className="bg-outline-variant hidden h-3 w-px @2xl:inline-block"
              />
              <span className="text-state-started font-medium">{stats.carryover} carryover</span>
            </>
          ) : null}
        </span>
      </button>

      {expanded ? (
        <div id="cycle-stats-body" className="flex flex-col gap-4 px-4 pb-4">
          <BurnupChart burnup={burnup} window={window} />

          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 @2xl:grid-cols-4">
            <Stat
              label="Committed"
              value={String(stats.committed)}
              hint={`${String(stats.completed)} completed`}
            />
            <Stat
              label="Capacity"
              value={`${String(stats.completedCapacity)} / ${String(stats.capacity)}`}
              hint={`${String(pacePct)}% of planned points`}
            />
            <Stat
              label="Scope added"
              value={String(stats.scopeChange)}
              hint={
                stats.scopeChange === 0 ? 'No mid-cycle creep' : `since this ${cycleNoun} opened`
              }
            />
            <Stat
              label="Carryover"
              value={String(stats.carryover)}
              hint={stats.carryover === 0 ? 'Nothing left open' : 'would roll on close'}
              tone={stats.carryover > 0 ? 'warning' : 'default'}
            />
          </dl>
        </div>
      ) : null}
    </section>
  );
}
