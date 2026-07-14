'use client';

/**
 * The child-health distribution bar for an Initiative.
 *
 * @remarks
 * An Initiative's status/health is auto-derived from the Projects + Programs it spans, so
 * the most honest summary is *how its children are distributed across the health buckets*.
 * This renders the `distribution` roll-up (`onTrack` / `atRisk` / `offTrack` / `unknown`)
 * as a single stacked, token-colored bar — a calm green run, an amber run, a red run, and a
 * neutral run for children with no verdict yet — sized proportionally to the child counts.
 *
 * The bar is decorative (`aria-hidden`); the accompanying legend carries the real,
 * screen-reader-accessible numbers so the signal is never color-only. When there are no
 * associated children at all the component renders an explicit empty hint instead of a
 * misleading full-width neutral bar.
 */
import type { InitiativeHealthDistribution } from '@docket/types';
import { cn } from '@docket/ui';
import type { JSX } from 'react';

import {
  HEALTH_FILL_CLASS,
  HEALTH_LABEL,
  HEALTH_UNKNOWN_FILL_CLASS,
  HEALTH_UNKNOWN_LABEL,
} from './health';

/** One ordered segment of the distribution bar (worst→best, neutral last). */
interface Segment {
  /** Stable key + legend label. */
  readonly key: string;
  readonly label: string;
  /** The child count in this bucket. */
  readonly count: number;
  /** The solid fill token class for the bar run + legend swatch. */
  readonly fill: string;
}

/** Build the ordered segments from a distribution roll-up. */
function segmentsOf(distribution: InitiativeHealthDistribution): readonly Segment[] {
  return [
    {
      key: 'off_track',
      label: HEALTH_LABEL.off_track,
      count: distribution.offTrack,
      fill: HEALTH_FILL_CLASS.off_track,
    },
    {
      key: 'at_risk',
      label: HEALTH_LABEL.at_risk,
      count: distribution.atRisk,
      fill: HEALTH_FILL_CLASS.at_risk,
    },
    {
      key: 'on_track',
      label: HEALTH_LABEL.on_track,
      count: distribution.onTrack,
      fill: HEALTH_FILL_CLASS.on_track,
    },
    {
      key: 'unknown',
      label: HEALTH_UNKNOWN_LABEL,
      count: distribution.unknown,
      fill: HEALTH_UNKNOWN_FILL_CLASS,
    },
  ];
}

/** Props for {@link DistributionBar}. */
export interface DistributionBarProps {
  /** The per-health-bucket child distribution from the detail roll-up. */
  distribution: InitiativeHealthDistribution;
  /** The plural entity noun for children (e.g. "projects & programs") for the empty hint. */
  childNounPlural: string;
}

/**
 * A stacked health-distribution bar with an accessible count legend.
 *
 * @param props - The {@link DistributionBarProps}.
 * @returns the rendered distribution block.
 */
export function DistributionBar({
  distribution,
  childNounPlural,
}: DistributionBarProps): JSX.Element {
  const segments = segmentsOf(distribution);
  const total = segments.reduce((sum, segment) => sum + segment.count, 0);

  if (total === 0) {
    return (
      <p className="text-on-surface-variant text-body-medium">
        No {childNounPlural} are associated yet — link some below to roll up their health here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        aria-hidden="true"
        className="bg-surface-container flex h-2.5 w-full overflow-hidden rounded-full"
      >
        {segments
          .filter((segment) => segment.count > 0)
          .map((segment) => (
            <div
              key={segment.key}
              className={cn('h-full first:rounded-l-full last:rounded-r-full', segment.fill)}
              style={{ width: `${(segment.count / total) * 100}%` }}
            />
          ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {segments
          .filter((segment) => segment.count > 0)
          .map((segment) => (
            <li key={segment.key} className="flex items-center gap-1.5 text-xs">
              <span aria-hidden="true" className={cn('size-2 rounded-full', segment.fill)} />
              <span className="text-on-surface font-medium tabular-nums">{segment.count}</span>
              <span className="text-on-surface-variant">{segment.label}</span>
            </li>
          ))}
      </ul>
    </div>
  );
}
