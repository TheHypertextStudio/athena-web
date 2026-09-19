'use client';

/**
 * `HeadsUpEntry` — the single line Athena speaks first with, above the rest of the thread.
 *
 * @remarks
 * Split out of `athena-conversation.tsx` so that already-ledgered file stays as it is rather than
 * growing: this owns the "Review" scroll-to-card behaviour and the "Dismiss" write. It paints as
 * one flat row — no tonal box, no border, no explainer copy — per §4.5 and §2.1 principle 3 of
 * `docs/superpowers/specs/2026-09-12-athena-companion-design.md`: initiative with restraint, one
 * heads-up at a time, sitting inside the same thread rather than boxed off from it.
 */
import { Button } from '@docket/ui/primitives';
import { type JSX } from 'react';

import type { HeadsUp } from '@/lib/athena/heads-ups';

/** Scrolls the named job's card into view, when it is already mounted in the thread. */
function scrollToJobCard(jobId: string): void {
  document.getElementById(`athena-job-${jobId}`)?.scrollIntoView({ block: 'center' });
}

/** Props for {@link HeadsUpEntry}. */
export interface HeadsUpEntryProps {
  /** The one heads-up to show. */
  readonly headsUp: HeadsUp;
  /** Called with the heads-up's id once the person closes it. */
  readonly onDismiss: (id: string) => void;
}

/** The thread's heads-up row: a label, one sentence, and its Review / Dismiss actions. */
export function HeadsUpEntry({ headsUp, onDismiss }: HeadsUpEntryProps): JSX.Element {
  return (
    <div className="flex flex-col gap-1 px-1">
      <span className="text-on-surface-variant text-label-small">Heads-up</span>
      <p className="text-on-surface text-body-medium">{headsUp.text}</p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => {
            scrollToJobCard(headsUp.jobId);
          }}
        >
          Review
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
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
  /** The id of a heads-up already closed this session, kept out of the ledgered host's own logic. */
  readonly closedId: string | null;
  /** Called with the heads-up's id once the person closes it. */
  readonly onDismiss: (id: string) => void;
}

/**
 * Picks the one heads-up still open and renders it, or nothing.
 *
 * @remarks
 * The pick-and-render branch lives here rather than in `athena-conversation.tsx` on purpose: that
 * host already carries a ledgered complexity debt (`tooling/eslint-config/complexity-debt.json`),
 * and the debt ledger may only shrink, never grow — so a new conditional belongs in a function
 * that starts at zero.
 */
export function AthenaHeadsUpSlot({
  headsUps,
  closedId,
  onDismiss,
}: AthenaHeadsUpSlotProps): JSX.Element | null {
  const headsUp = headsUps.find((candidate) => candidate.id !== closedId) ?? null;
  if (!headsUp) return null;
  return <HeadsUpEntry headsUp={headsUp} onDismiss={onDismiss} />;
}
