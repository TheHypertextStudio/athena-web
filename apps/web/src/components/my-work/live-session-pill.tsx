'use client';

import type { SessionStatus } from '@docket/types';
import { CircleDot, RefreshCw, Sparkles, XCircle } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import Link from 'next/link';
import type { JSX } from 'react';

/** The session statuses that read as "live" and get a pill in the work view. */
export type LiveSessionStatus = Extract<
  SessionStatus,
  'pending' | 'running' | 'awaiting_approval' | 'awaiting_input'
>;

/** A live session status plus the terminal `failed` (errored) state the pill also surfaces. */
export type PillStatus = LiveSessionStatus | 'failed';

/** The visual + semantic treatment for one {@link PillStatus}. */
interface PillTreatment {
  /** The short label shown in the pill. */
  readonly label: string;
  /** The longer accessible announcement (read by screen readers + as the `title`). */
  readonly hint: string;
  /** The leading glyph component. */
  readonly Glyph: React.ComponentType<{ className?: string }>;
  /** Token-driven container classes (background, border, text). */
  readonly tone: string;
  /** Whether the glyph should pulse to signal in-flight work. */
  readonly pulse: boolean;
}

/**
 * Per-status pill treatment.
 *
 * @remarks
 * Colors come exclusively from semantic design tokens — never hardcoded. `running` adopts
 * the `state-started` token (the same in-progress hue the status icon uses) with a pulsing
 * glyph so an active run reads as alive; `awaiting_approval` escalates to the `destructive`
 * token because it is the one state that needs the human, mirroring how `urgent` priority
 * draws the eye; `awaiting_input` (a paused, steerable session) and `pending` (queued) stay
 * calm on the `muted` token; `failed` is a quiet `destructive` outline so an errored run is
 * unmistakable without shouting.
 */
const PILL_TREATMENT: Record<PillStatus, PillTreatment> = {
  running: {
    label: 'Running',
    hint: 'Agent run in progress',
    Glyph: RefreshCw,
    tone: 'border-state-started/30 bg-state-started/10 text-state-started',
    pulse: true,
  },
  awaiting_approval: {
    label: 'Needs approval',
    hint: 'Awaiting your approval',
    Glyph: CircleDot,
    tone: 'border-destructive/40 bg-destructive/10 text-destructive',
    pulse: true,
  },
  awaiting_input: {
    label: 'Paused',
    hint: 'Paused — awaiting input',
    Glyph: CircleDot,
    tone: 'border-border bg-muted text-muted-foreground',
    pulse: false,
  },
  pending: {
    label: 'Queued',
    hint: 'Run queued',
    Glyph: Sparkles,
    tone: 'border-border bg-muted text-muted-foreground',
    pulse: false,
  },
  failed: {
    label: 'Errored',
    hint: 'Agent run errored',
    Glyph: XCircle,
    tone: 'border-destructive/40 bg-destructive/10 text-destructive',
    pulse: false,
  },
};

/** Props for {@link LiveSessionPill}. */
export interface LiveSessionPillProps {
  /** The session status to render. */
  status: PillStatus;
  /** The route the pill links to (the task detail / session). */
  href: string;
  /** Extra classes merged onto the pill. */
  className?: string;
}

/**
 * A compact live-session status pill for an agent-run task row.
 *
 * @remarks
 * Surfaces the lifecycle of the agent session driving a task — running, awaiting your
 * approval, paused, queued, or errored — as a small token-colored pill that links to the
 * task detail / session so a reviewer can act in one click. The pill is an anchor (`Link`)
 * with its own focus ring and a `stopPropagation` so activating it never also activates the
 * surrounding list row. In-flight states pulse their glyph; the accessible label spells out
 * the state for assistive tech.
 *
 * @example
 * ```tsx
 * <LiveSessionPill status="awaiting_approval" href={`/orgs/${orgId}/tasks/${taskId}`} />
 * ```
 */
export function LiveSessionPill({ status, href, className }: LiveSessionPillProps): JSX.Element {
  const { label, hint, Glyph, tone, pulse } = PILL_TREATMENT[status];
  return (
    <Link
      href={href}
      title={hint}
      aria-label={hint}
      onClick={(event) => {
        event.stopPropagation();
      }}
      className={cn(
        'focus-visible:ring-ring inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        'transition-colors outline-none hover:brightness-105 focus-visible:ring-1',
        tone,
        className,
      )}
    >
      <Glyph className={cn('h-3 w-3', pulse && 'animate-pulse')} />
      <span>{label}</span>
    </Link>
  );
}

/**
 * Map a raw {@link SessionStatus} to the {@link PillStatus} a row should show, or `null`.
 *
 * @remarks
 * Only the in-flight lifecycle states (and the terminal `failed`) read as a live session
 * worth a pill; settled, expected-terminal states (`completed`, `canceled`) carry no pill
 * because the row's own status icon already tells that story. When a task has several
 * sessions the caller picks the most actionable one before calling this (see the page's
 * `liveSessionForTask`).
 *
 * @param status - The session's lifecycle status.
 * @returns the pill status to render, or `null` when no pill should show.
 */
export function pillStatusOf(status: SessionStatus): PillStatus | null {
  switch (status) {
    case 'running':
    case 'awaiting_approval':
    case 'awaiting_input':
    case 'pending':
    case 'failed':
      return status;
    case 'completed':
    case 'canceled':
      return null;
  }
}
