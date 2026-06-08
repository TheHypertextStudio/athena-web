'use client';

/**
 * A single Project bar on the Hub Portfolio roadmap.
 *
 * @remarks
 * A Project is a *bounded* effort, so it draws as a dated bar positioned across the
 * weeks/months it spans. The bar is tinted by the Project's `health` (so a struggling effort
 * reads red wherever it sits in time) and deep-links to the Project detail in its own org. Any
 * Milestones that fall inside the visible window render as small diamonds along the bar — the
 * concrete checkpoints on the effort. The bar is a keyboard-focusable link with a descriptive
 * `aria-label` (name · status · span · health) and a hover/focus lift.
 *
 * Layout is done with absolute percentage offsets against the shared {@link TimeScale}, so the
 * whole roadmap stays responsive to whatever pixel width the horizontal scroll area resolves
 * to. A very short or single-date bar is floored to a minimum visible width.
 */
import type { Health, HubMilestoneItem, HubProjectBar } from '@docket/types';
import { cn } from '@docket/ui';
import Link from 'next/link';
import type { JSX } from 'react';

import { formatDate, spanCopy, statusLabel } from './format';
import { asHealth, barClassFor, labelFor } from './health';
import { type TimeScale, pct } from './time-scale';

/** The minimum bar width (% of the window) so a thin/single-date span stays clickable. */
const MIN_BAR_PCT = 2;

/** A milestone resolved to its position on the axis (epoch ms + in-window flag). */
interface PlacedMilestone {
  readonly milestone: HubMilestoneItem;
  readonly at: number;
}

/** Props for {@link ProjectBar}. */
export interface ProjectBarProps {
  /** The project bar DTO. */
  bar: HubProjectBar;
  /** The bar's resolved span start in epoch ms. */
  start: number;
  /** The bar's resolved span end in epoch ms. */
  end: number;
  /** The shared time scale the bar is positioned against. */
  scale: TimeScale;
  /** Whether the bar is dimmed (another org is focused). */
  dimmed: boolean;
}

/**
 * Render one positioned Project bar with its milestone diamonds.
 *
 * @param props - The {@link ProjectBarProps}.
 * @returns the rendered bar.
 */
export function ProjectBar({ bar, start, end, scale, dimmed }: ProjectBarProps): JSX.Element {
  const health: Health | null = asHealth(bar.health);
  const left = pct(start, scale);
  const width = Math.max(pct(end, scale) - left, MIN_BAR_PCT);

  // Resolve milestones with a target date that lands inside the visible window.
  const placed: PlacedMilestone[] = [];
  for (const m of bar.milestones) {
    if (!m.targetDate) continue;
    const at = Date.parse(m.targetDate);
    if (Number.isNaN(at) || at < scale.min || at > scale.max) continue;
    placed.push({ milestone: m, at });
  }

  const span = spanCopy(bar.startDate, bar.targetDate);
  const ariaLabel = `${bar.name} — ${statusLabel(bar.status)}, ${span}, ${labelFor(health)}${
    placed.length > 0 ? `, ${placed.length} milestone${placed.length === 1 ? '' : 's'}` : ''
  }`;

  return (
    <div className="relative h-8">
      <Link
        href={`/orgs/${bar.organizationId}/projects/${bar.id}`}
        aria-label={ariaLabel}
        title={`${bar.name} · ${span}`}
        className={cn(
          'focus-visible:ring-ring group absolute top-0 flex h-8 min-w-0 items-center gap-2 rounded-md border px-2.5 text-left text-xs font-medium shadow-sm transition-[filter,opacity] hover:brightness-110 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none',
          barClassFor(health),
          dimmed && 'opacity-30',
        )}
        style={{ left: `${left}%`, width: `${width}%` }}
      >
        <span className="truncate">{bar.name}</span>
      </Link>

      {/* Milestone diamonds, laid over the bar at their target offsets. */}
      {placed.map(({ milestone, at }) => (
        <span
          key={milestone.id}
          aria-hidden="true"
          title={`${milestone.name}${milestone.targetDate ? ` · ${formatDate(milestone.targetDate)}` : ''}`}
          className={cn(
            'border-surface bg-surface pointer-events-none absolute top-1/2 z-[1] size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] border shadow-sm transition-opacity',
            dimmed && 'opacity-30',
          )}
          style={{ left: `${pct(at, scale)}%` }}
        />
      ))}
    </div>
  );
}
