'use client';

/**
 * `settings` — the shared "Saving… / Saved" status affordance for an autosaving settings field.
 *
 * @remarks
 * One implementation for every autosaving settings surface. A save that fails leaves `saved` false,
 * so the line goes quiet; the mutation presents the failure itself as a notice.
 */
import { type JSX } from 'react';

/** Props for {@link SettingRowStatus}. */
export interface SettingRowStatusProps {
  /** Whether the field's autosave mutation is in flight. */
  readonly pending: boolean;
  /** Whether the mutation's most recent run succeeded. */
  readonly saved: boolean;
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

/** The line's text for the field's current save state. */
function statusText({ pending, saved, idleLabel }: SettingRowStatusProps): string {
  if (pending) return 'Saving…';
  if (saved) return 'Saved';
  return idleLabel ?? '';
}

/** Inline "Saving… / Saved" affordance shared by every autosaving settings field. */
export function SettingRowStatus(props: SettingRowStatusProps): JSX.Element {
  return (
    <p aria-live="polite" className="text-on-surface-variant text-body-small">
      {statusText(props)}
    </p>
  );
}
