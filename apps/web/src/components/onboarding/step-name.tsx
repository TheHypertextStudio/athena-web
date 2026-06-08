'use client';

/**
 * `onboarding/step-name` — the team / nonprofit fork's "name your organization" screen.
 *
 * @remarks
 * One concept per screen: just the org name, with a one-line reassurance that this is a shared
 * space and more can be created later. The input auto-focuses and submits on Enter so the
 * step can be cleared from the keyboard alone; the parent owns the next/disabled logic.
 */
import { Input } from '@docket/ui/primitives';
import type { JSX } from 'react';

/** Props for {@link StepName}. */
export interface StepNameProps {
  /** The current org-name value. */
  value: string;
  /** Invoked with the new value on every edit. */
  onChange: (value: string) => void;
  /** Invoked when the user submits the field (Enter) while it is valid. */
  onSubmit: () => void;
  /** Whether the field currently holds a submittable value. */
  canSubmit: boolean;
}

/**
 * The team / nonprofit fork's name step.
 */
export function StepName({ value, onChange, onSubmit, canSubmit }: StepNameProps): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="org-name" className="text-on-surface text-sm font-medium">
        Organization name
      </label>
      <Input
        id="org-name"
        type="text"
        autoFocus
        autoComplete="organization"
        required
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && canSubmit) {
            event.preventDefault();
            onSubmit();
          }
        }}
        placeholder="Acme Inc."
        className="h-11 text-base"
      />
      <p className="text-on-surface-variant mt-1 text-sm">
        This is the shared space your team will work in. You can rename it — or create more — at any
        time.
      </p>
    </div>
  );
}
