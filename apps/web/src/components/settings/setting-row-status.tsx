'use client';

/**
 * `settings` — the shared "Saving… / Saved" status affordance for an autosaving settings field.
 *
 * @remarks
 * Before this, the same status-line markup was hand-written independently in at least three
 * settings surfaces (`profile/page.tsx`, `workspace-general-settings.tsx`, and a private
 * `AutosaveStatus` component in `work-structure/page.tsx`), each slightly different. This is that
 * seam, given one shared implementation.
 */
import { type JSX } from 'react';

/** Props for {@link SettingRowStatus}. */
export interface SettingRowStatusProps {
  /** Whether the field's autosave mutation is in flight. */
  readonly pending: boolean;
  /** Whether the mutation's most recent run succeeded. */
  readonly saved: boolean;
  /** A user-facing error message, if the most recent save failed. */
  readonly error?: string | null;
  /**
   * What to show once settled with no unsaved change in flight (e.g. "Current maximum: 2").
   *
   * @remarks
   * Omit for a plain field that has nothing worth restating when idle (the common case — most
   * rows just go quiet). Fields whose current value isn't otherwise visible in the control itself
   * (a segmented picker with no persistent label, say) can use this to keep saying what's
   * currently saved even between edits.
   */
  readonly idleLabel?: string;
}

/** Inline "Saving… / Saved" affordance shared by every autosaving settings field. */
export function SettingRowStatus({
  pending,
  saved,
  error,
  idleLabel,
}: SettingRowStatusProps): JSX.Element {
  if (error) {
    return (
      <p role="alert" className="text-error text-xs">
        {error}
      </p>
    );
  }
  return (
    <p aria-live="polite" className="text-on-surface-variant text-xs">
      {pending ? 'Saving…' : saved ? 'Saved' : (idleLabel ?? '')}
    </p>
  );
}
