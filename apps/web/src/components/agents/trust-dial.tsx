'use client';

/**
 * The trust dial — an agent's approval policy as a three-position segmented control,
 * in human words (mvp-plan §8.6: "trust is dialed, never assumed").
 *
 * @remarks
 * The three positions map onto `ApprovalPolicy`:
 *
 * - **Suggest only** (`suggest`) — she lines changes up; you place them.
 * - **Ask first** (`act_with_approval`, the default) — she works; writes pause for
 *   your sign-off, and approving executes them.
 * - **On her own** (`autonomous`) — writes apply immediately, fully audited.
 *
 * Reads always run under every position — the dial gates mutation, not observation.
 * Purely presentational: the parent owns the PATCH + pending state.
 */
import type { ApprovalPolicy } from '@docket/types';
import { cn } from '@docket/ui/lib/utils';
import { type JSX } from 'react';

/** The dial positions, in ascending autonomy, with their human wording. */
const POSITIONS: readonly { value: ApprovalPolicy; label: string; hint: string }[] = [
  { value: 'suggest', label: 'Suggest only', hint: 'Lines changes up; you place them' },
  { value: 'act_with_approval', label: 'Ask first', hint: 'Works, but writes wait for you' },
  { value: 'autonomous', label: 'On her own', hint: 'Applies changes, fully audited' },
];

/** Props for {@link TrustDial}. */
export interface TrustDialProps {
  /** The agent's current approval policy. */
  value: ApprovalPolicy;
  /** Whether the viewer may change it (the `manage` bar). */
  canManage: boolean;
  /** Whether a change is in flight. */
  pending: boolean;
  /** Commit a new position. */
  onChange: (value: ApprovalPolicy) => void;
}

/**
 * The three-position trust dial for one agent.
 */
export function TrustDial({ value, canManage, pending, onChange }: TrustDialProps): JSX.Element {
  const fallback: (typeof POSITIONS)[number] = {
    value: 'act_with_approval',
    label: 'Ask first',
    hint: 'Works, but writes wait for you',
  };
  const active = POSITIONS.find((p) => p.value === value) ?? fallback;
  return (
    <div className="flex flex-col gap-1">
      <div
        role="radiogroup"
        aria-label="How much can this agent do on its own?"
        className="border-outline-variant bg-surface-container inline-flex w-fit items-center gap-0.5 rounded-lg border p-0.5"
      >
        {POSITIONS.map((position) => {
          const selected = position.value === value;
          return (
            <button
              key={position.value}
              type="button"
              role="radio"
              aria-checked={selected}
              title={position.hint}
              disabled={!canManage || pending}
              onClick={() => {
                if (!selected) onChange(position.value);
              }}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors outline-none',
                'focus-visible:ring-ring focus-visible:ring-1',
                selected
                  ? 'bg-primary text-on-primary shadow-sm'
                  : 'text-on-surface-variant hover:text-on-surface',
                (!canManage || pending) && !selected ? 'opacity-60' : '',
              )}
            >
              {position.label}
            </button>
          );
        })}
      </div>
      <p className="text-on-surface-variant text-xs">{active.hint}.</p>
    </div>
  );
}
