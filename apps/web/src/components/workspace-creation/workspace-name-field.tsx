'use client';

import { Input } from '@docket/ui/primitives';
import type { JSX } from 'react';

/** Props for the shared workspace-name field. */
export interface WorkspaceNameFieldProps {
  /** The current workspace-name value. */
  value: string;
  /** Invoked whenever the name changes. */
  onChange: (value: string) => void;
  /** Invoked when Enter is pressed with a valid value. */
  onSubmit: () => void;
  /** Whether the current value is valid for submission. */
  canSubmit: boolean;
}

/**
 * The shared workspace-name field used by onboarding and repeat creation.
 *
 * @param props - Controlled value, validation state, and submit callbacks.
 * @returns the accessible name input and supporting copy.
 */
export function WorkspaceNameField({
  value,
  onChange,
  onSubmit,
  canSubmit,
}: WorkspaceNameFieldProps): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="workspace-name" className="text-on-surface text-body-medium font-medium">
        Workspace name
      </label>
      <Input
        id="workspace-name"
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
      <p className="text-on-surface-variant text-body-medium mt-1">
        This is the shared space your team will work in. You can rename it or create more later.
      </p>
    </div>
  );
}
