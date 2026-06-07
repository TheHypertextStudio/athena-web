'use client';

/**
 * The Program HEALTH + FLOW snapshot — the lead of the Program detail screen.
 *
 * @remarks
 * A Program is *ongoing* operations, so — unlike a Project — it has no finish line and
 * therefore NO percent-complete bar (§8.4). Instead the snapshot answers "how is this line
 * of work flowing right now?": the current health verdict reads large and color-coded, and
 * a row of flow metrics reports the operational picture — work *in flight* (started),
 * *queued* (not yet started), *done recently*, and the structural scope (active cycles and
 * the count of projects under the program). The latest update's relative stamp grounds the
 * health in time ("as of 2h ago") so a stale verdict is obvious.
 *
 * All color comes from semantic tokens; the metric tiles use tabular numerals so the row
 * stays aligned, and each tile is plain text (not an interactive control) so the snapshot
 * reads as a calm status banner.
 */
import type { Health } from '@docket/types';
import { cn } from '@docket/ui';
import { CheckCircle2, CircleDashed, CircleDot, FolderKanban, RefreshCw } from '@docket/ui/icons';
import type { JSX, ReactNode } from 'react';

import { relativeTime } from './format-time';
import { HEALTH_DOT_CLASS, HEALTH_LABEL } from './health';

/** The flow metrics the snapshot reports, rolled up from the program's work + structure. */
export interface FlowMetrics {
  /** Tasks currently in progress (workflow-state type `started`). */
  inFlight: number;
  /** Tasks not yet started (backlog + todo). */
  queued: number;
  /** Tasks completed. */
  done: number;
  /** Distinct cycles the program's work currently spans. */
  activeCycles: number;
  /** Projects under the program. */
  projects: number;
}

/** Props for {@link FlowSnapshot}. */
export interface FlowSnapshotProps {
  /** The program's current health verdict, or `null` when unset. */
  health: Health | null;
  /** ISO timestamp of the latest status update, to ground the verdict in time. */
  healthAsOf: string | null;
  /** The rolled-up flow metrics. */
  metrics: FlowMetrics;
  /** Plural noun for a project (vocabulary-skinned), capitalized for a tile label. */
  projectsLabel: string;
  /** Plural noun for a cycle (vocabulary-skinned), capitalized for a tile label. */
  cyclesLabel: string;
}

/**
 * The HEALTH + FLOW snapshot banner.
 *
 * @param props - The {@link FlowSnapshotProps}.
 * @returns the rendered snapshot.
 */
export function FlowSnapshot({
  health,
  healthAsOf,
  metrics,
  projectsLabel,
  cyclesLabel,
}: FlowSnapshotProps): JSX.Element {
  return (
    <section
      aria-label="Health and flow"
      className="border-border bg-card flex flex-col gap-5 rounded-xl border p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className={cn(
              'size-2.5 rounded-full',
              health ? HEALTH_DOT_CLASS[health] : 'bg-muted-foreground/50',
            )}
          />
          <span className="text-foreground text-lg font-semibold tracking-tight">
            {health ? HEALTH_LABEL[health] : 'No health set'}
          </span>
        </div>
        {healthAsOf ? (
          <span className="text-muted-foreground text-xs">as of {relativeTime(healthAsOf)}</span>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Metric
          icon={<CircleDot className="size-4" />}
          label="In flight"
          value={metrics.inFlight}
          tone="started"
        />
        <Metric
          icon={<CircleDashed className="size-4" />}
          label="Queued"
          value={metrics.queued}
          tone="muted"
        />
        <Metric
          icon={<CheckCircle2 className="size-4" />}
          label="Done"
          value={metrics.done}
          tone="completed"
        />
        <Metric
          icon={<RefreshCw className="size-4" />}
          label={cyclesLabel}
          value={metrics.activeCycles}
          tone="muted"
        />
        <Metric
          icon={<FolderKanban className="size-4" />}
          label={projectsLabel}
          value={metrics.projects}
          tone="muted"
        />
      </dl>
    </section>
  );
}

/** The token color for a metric's value + glyph, by semantic tone. */
const TONE_CLASS: Record<'started' | 'completed' | 'muted', string> = {
  started: 'text-state-started',
  completed: 'text-state-completed',
  muted: 'text-foreground',
};

/** One flow metric tile: an icon, a tabular value, and a muted label. */
function Metric({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  tone: 'started' | 'completed' | 'muted';
}): JSX.Element {
  return (
    <div className="border-border bg-background flex flex-col gap-1 rounded-lg border p-3">
      <span
        aria-hidden="true"
        className={cn(
          'flex items-center',
          tone === 'muted' ? 'text-muted-foreground' : TONE_CLASS[tone],
        )}
      >
        {icon}
      </span>
      <dd className={cn('text-2xl font-semibold tabular-nums', TONE_CLASS[tone])}>{value}</dd>
      <dt className="text-muted-foreground text-xs">{label}</dt>
    </div>
  );
}
