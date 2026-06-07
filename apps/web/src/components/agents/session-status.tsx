'use client';

/**
 * Shared status vocabulary for the Agents (sessions) flagship — the canonical label,
 * tone, and glyph for every {@link SessionStatus}, used by both the feed status pills and
 * the session-view header.
 *
 * @remarks
 * Colors come exclusively from semantic design tokens (`state-started`, `destructive`,
 * `state-completed`, `muted`) — never hardcoded — so the same lifecycle reads identically
 * across light/dark and stays cohesive with the {@link import('../my-work/live-session-pill').LiveSessionPill | work-view pill}.
 * The escalation logic mirrors that pill: `awaiting_approval` borrows the `destructive`
 * token because it is the one state that needs a human, `running` adopts the in-progress
 * `state-started` hue with a pulse, and settled states stay calm.
 */
import type { SessionStatus } from '@docket/types';
import { CheckCircle2, CircleDashed, CircleDot, RefreshCw, XCircle } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import type { JSX } from 'react';

/** The visual + semantic treatment for one {@link SessionStatus}. */
interface StatusTreatment {
  /** Short label shown in the pill. */
  readonly label: string;
  /** Longer accessible/`title` description. */
  readonly hint: string;
  /** Leading glyph component. */
  readonly Glyph: React.ComponentType<{ className?: string }>;
  /** Token-driven container classes (border, background, text). */
  readonly tone: string;
  /** Whether the glyph pulses to signal in-flight work. */
  readonly pulse: boolean;
}

/** Per-status treatment for every session lifecycle state. */
const STATUS_TREATMENT: Record<SessionStatus, StatusTreatment> = {
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
    hint: 'Paused — awaiting your input',
    Glyph: CircleDot,
    tone: 'border-border bg-muted text-muted-foreground',
    pulse: false,
  },
  pending: {
    label: 'Queued',
    hint: 'Run queued, not yet started',
    Glyph: CircleDashed,
    tone: 'border-border bg-muted text-muted-foreground',
    pulse: false,
  },
  completed: {
    label: 'Done',
    hint: 'Run completed',
    Glyph: CheckCircle2,
    tone: 'border-state-completed/30 bg-state-completed/10 text-state-completed',
    pulse: false,
  },
  failed: {
    label: 'Errored',
    hint: 'Agent run errored',
    Glyph: XCircle,
    tone: 'border-destructive/40 bg-destructive/10 text-destructive',
    pulse: false,
  },
  canceled: {
    label: 'Canceled',
    hint: 'Run canceled',
    Glyph: XCircle,
    tone: 'border-border bg-muted text-muted-foreground',
    pulse: false,
  },
};

/** Props for {@link SessionStatusPill}. */
export interface SessionStatusPillProps {
  /** The session lifecycle status to render. */
  status: SessionStatus;
  /** Extra classes merged onto the pill. */
  className?: string;
}

/**
 * A compact, token-colored status pill for an agent session.
 *
 * @remarks
 * Reads the same across the feed rows and the session-view header. In-flight states pulse
 * their glyph; the accessible label spells out the state for assistive tech.
 */
export function SessionStatusPill({ status, className }: SessionStatusPillProps): JSX.Element {
  const { label, hint, Glyph, tone, pulse } = STATUS_TREATMENT[status];
  return (
    <span
      title={hint}
      aria-label={hint}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        tone,
        className,
      )}
    >
      <Glyph className={cn('h-3 w-3', pulse && 'animate-pulse')} />
      <span>{label}</span>
    </span>
  );
}

/**
 * Resolve a session status to its short human label (without rendering a pill).
 *
 * @param status - The session lifecycle status.
 * @returns the short label (e.g. `'Needs approval'`).
 */
export function sessionStatusLabel(status: SessionStatus): string {
  return STATUS_TREATMENT[status].label;
}
