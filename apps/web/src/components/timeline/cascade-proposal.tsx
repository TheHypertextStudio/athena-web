'use client';

/**
 * `timeline` — the downstream-ripple proposal surface.
 *
 * @remarks
 * This is where Docket's dependency stance becomes visible. A drag has already committed by the
 * time this appears — the gesture was never blocked, nothing snapped back, and no dialog
 * interrupted the user. What appears is an *offer*: the moved row now finishes after N dependents
 * were due to start, and here is the smallest set of shifts that would clear it.
 *
 * Deliberately non-modal and deliberately dismissible. It does not trap focus, does not gate any
 * other interaction, and disappears on the next drag. Dismissing is a real choice rather than a
 * deferral: the affected edges stay red afterwards, so the unresolved constraint remains visible
 * instead of being quietly forgotten.
 */
import { Button } from '@docket/ui/primitives';
import { X } from '@docket/ui/icons';
import type { JSX } from 'react';

import type { ScheduleChange } from './cascade';

/** Props for {@link CascadeProposal}. */
export interface CascadeProposalProps {
  /** The proposed downstream shifts. */
  changes: readonly ScheduleChange[];
  /** Resolve an affected row's id to its display name. */
  nameOf: (id: string) => string;
  /** The plural noun for the affected entity. */
  noun: string;
  /** Whether the proposal is currently being applied. */
  applying: boolean;
  /** Apply every proposed shift as one undoable transaction. */
  onApply: () => void;
  /** Dismiss the proposal, leaving the violated edges standing. */
  onDismiss: () => void;
}

/**
 * Render the ripple proposal, or nothing when a drag caused no downstream pressure.
 *
 * @param props - The {@link CascadeProposalProps}.
 * @returns the proposal bar, or `null`.
 */
export default function CascadeProposal({
  changes,
  nameOf,
  noun,
  applying,
  onApply,
  onDismiss,
}: CascadeProposalProps): JSX.Element | null {
  if (changes.length === 0) return null;

  const names = changes.slice(0, 2).map((change) => nameOf(change.id));
  const rest = changes.length - names.length;
  const summary = rest > 0 ? `${names.join(', ')} and ${rest} more` : names.join(' and ');

  return (
    <div
      role="status"
      className="border-outline-variant bg-surface-container-high flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2.5 shadow-sm"
    >
      <p className="text-on-surface min-w-0 flex-1 text-xs">
        <span className="font-semibold">
          That pushes {changes.length} downstream {noun}
        </span>
        <span className="text-on-surface-variant"> — {summary}.</span>
      </p>
      <div className="flex items-center gap-1.5">
        <Button size="sm" onClick={onApply} disabled={applying}>
          {applying ? 'Applying…' : 'Apply shifts'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss} aria-label="Dismiss proposal">
          <X aria-hidden className="size-4" />
        </Button>
      </div>
    </div>
  );
}
