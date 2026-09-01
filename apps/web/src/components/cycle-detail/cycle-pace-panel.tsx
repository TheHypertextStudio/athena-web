'use client';

/**
 * `cycle-detail` — the Pace tab: "are we on track?" for one cycle (product §8.5).
 *
 * @remarks
 * This replaces the collapsible stats *banner* that used to sit between the masthead and the task
 * list. The banner had two problems the redesign removes structurally rather than by tuning it:
 *
 * - It was a flex child of a fixed-height (`h-full`) page column, so the browser shrank it to make
 *   room for the task list. On a desktop it lost most of its body (the burn-up plot region rendered
 *   as an empty strip with one orphaned dashed "today" rule); on a phone it collapsed to a bare
 *   hairline, which read as a horizontal rule separating nothing and made the whole Pace section
 *   effectively absent on mobile.
 * - It carried a disclosure control whose only job was to give the list back the height the banner
 *   had taken. Promoting pace to a peer tab of Tasks means neither section competes for height at
 *   all, so the control has nothing left to do and the panel renders identically at every width.
 *
 * Everything is drawn with semantic MD3 tokens on tonal surfaces — no hardcoded color, no borders
 * around each tile, and the type scale resolves to real tokens (`text-label-medium` /
 * `text-title-medium`) rather than the raw `text-xs` / `text-lg font-semibold` the banner used.
 */
import type { CycleBurnupOut } from '@docket/work/cycle-contract';
import { cn } from '@docket/ui/lib/utils';
import type { JSX } from 'react';

import { BurnupChart } from '@/components/cycles/burnup-chart';
import type { WindowProgress } from '@/components/cycles/format-window';

/** Props for {@link CyclePacePanel}. */
export interface CyclePacePanelProps {
  /** The cycle's burn-up report (daily series + rolled-up stats). */
  burnup: CycleBurnupOut;
  /** The window's live progress (drives the chart's "today" marker). */
  window: WindowProgress;
  /** The (vocabulary-resolved) singular cycle noun, lowercased for inline copy. */
  cycleNoun: string;
}

/** Props for one metric tile in the pace grid. */
interface StatProps {
  /** The metric's short name. */
  readonly label: string;
  /** The metric's value, pre-formatted. */
  readonly value: string;
  /** A one-line gloss under the value. */
  readonly hint: string;
  /** `warning` tints the value when the number wants attention (open carryover). */
  readonly tone?: 'default' | 'warning';
}

/** A single labelled metric tile on the low container tone. */
function Stat({ label, value, hint, tone = 'default' }: StatProps): JSX.Element {
  return (
    <div className="bg-surface-container-low flex flex-col gap-1 rounded-xl p-4">
      <dt className="text-on-surface-variant text-label-medium">{label}</dt>
      <dd className="flex flex-col gap-0.5">
        <span
          className={cn(
            'text-on-surface text-title-medium tabular-nums',
            tone === 'warning' && 'text-state-started',
          )}
        >
          {value}
        </span>
        <span className="text-on-surface-variant text-label-medium">{hint}</span>
      </dd>
    </div>
  );
}

/**
 * The cycle detail's Pace panel: the burn-up plot above a four-tile metric grid.
 *
 * @example
 * ```tsx
 * <CyclePacePanel burnup={burnup} window={windowProgress(cy.startsAt, cy.endsAt)} cycleNoun="cycle" />
 * ```
 *
 * @param props - The {@link CyclePacePanelProps}.
 * @returns the rendered pace panel.
 */
export function CyclePacePanel({ burnup, window, cycleNoun }: CyclePacePanelProps): JSX.Element {
  const { stats } = burnup;
  const pacePct =
    stats.capacity === 0 ? 0 : Math.round((stats.completedCapacity / stats.capacity) * 100);

  return (
    <div className="flex flex-col gap-4">
      <section
        aria-label={`${cycleNoun} burn-up`}
        className="bg-surface-container-low rounded-xl p-4"
      >
        <BurnupChart burnup={burnup} window={window} />
      </section>

      <dl className="grid grid-cols-2 gap-4 @2xl:grid-cols-4">
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
          hint={stats.scopeChange === 0 ? 'No mid-cycle creep' : `Since this ${cycleNoun} opened`}
        />
        <Stat
          label="Carryover"
          value={String(stats.carryover)}
          hint={stats.carryover === 0 ? 'Nothing left open' : 'Would roll on close'}
          tone={stats.carryover > 0 ? 'warning' : 'default'}
        />
      </dl>
    </div>
  );
}
