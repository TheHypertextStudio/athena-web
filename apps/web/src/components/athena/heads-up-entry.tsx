'use client';

/**
 * `HeadsUpEntry` — the one sentence Athena speaks first with, at the bottom of the thread.
 *
 * @remarks
 * Newest-at-bottom is the thread's order, and a heads-up is the newest thing in it, so it sits
 * below every other entry, just above the composer. It paints as one flat row in the work entry's
 * 24px gutter — the sentence and its Review / Dismiss actions, no label, no box — per §4.5 and
 * §2.1 principle 3 of `docs/superpowers/specs/2026-09-12-athena-companion-design.md`: initiative
 * with restraint, one heads-up at a time.
 */
import { Button } from '@docket/ui/primitives';
import { type JSX } from 'react';

import type { HeadsUp } from '@/lib/athena/heads-ups';

/** Props for {@link HeadsUpEntry}. */
export interface HeadsUpEntryProps {
  /** The one heads-up to show. */
  readonly headsUp: HeadsUp;
  /** Bring the named job's entry into view in the host's own thread. */
  readonly onReview: (jobId: string) => void;
  /** Called with the heads-up's id once the person closes it. */
  readonly onDismiss: (id: string) => void;
}

/** The thread's heads-up row: one sentence, then Review and Dismiss. */
export function HeadsUpEntry({ headsUp, onReview, onDismiss }: HeadsUpEntryProps): JSX.Element {
  return (
    <div data-slot="athena-heads-up" className="flex max-w-160 flex-col gap-2 pl-6">
      <p className="text-on-surface text-body-medium">{headsUp.text}</p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          controlSize="md"
          onClick={() => {
            onReview(headsUp.jobId);
          }}
        >
          Review
        </Button>
        <Button
          type="button"
          variant="ghost"
          controlSize="md"
          onClick={() => {
            onDismiss(headsUp.id);
          }}
        >
          Dismiss
        </Button>
      </div>
    </div>
  );
}

/** Props for {@link AthenaHeadsUpSlot}. */
export interface AthenaHeadsUpSlotProps {
  /** Every heads-up the thread's jobs currently qualify for (zero or one entry). */
  readonly headsUps: readonly HeadsUp[];
  /** The id of a heads-up already closed this session. */
  readonly closedId: string | null;
  /** Bring the named job's entry into view in the host's own thread. */
  readonly onReview: (jobId: string) => void;
  /** Called with the heads-up's id once the person closes it. */
  readonly onDismiss: (id: string) => void;
}

/** Picks the one heads-up still open and renders it, or nothing. */
export function AthenaHeadsUpSlot({
  headsUps,
  closedId,
  onReview,
  onDismiss,
}: AthenaHeadsUpSlotProps): JSX.Element | null {
  const headsUp = headsUps.find((candidate) => candidate.id !== closedId) ?? null;
  if (!headsUp) return null;
  return <HeadsUpEntry headsUp={headsUp} onReview={onReview} onDismiss={onDismiss} />;
}
