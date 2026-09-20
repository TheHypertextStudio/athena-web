'use client';

import { Button, Text } from '@docket/ui/primitives';
import type { JSX } from 'react';

/** Shared confirmation used when creating a workspace person from a picker or mention. */
export interface PersonCreateConfirmationProps {
  name: string;
  workspaceName: string;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirm recording a person without sending an invitation or granting account access. */
export function PersonCreateConfirmation({
  name,
  workspaceName,
  busy,
  error,
  onConfirm,
  onCancel,
}: PersonCreateConfirmationProps): JSX.Element {
  return (
    <div className="flex flex-col gap-3 p-3" role="group" aria-label="Add person confirmation">
      <Text token="title-small">
        Add “{name}” to {workspaceName}?
      </Text>
      <Text token="body-small">Creates a person record. No invitation will be sent.</Text>
      {error ? (
        <Text token="body-small" tone="error" role="alert">
          {error}
        </Text>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" autoFocus disabled={busy} onClick={onConfirm}>
          {busy ? 'Adding…' : 'Add and select'}
        </Button>
      </div>
    </div>
  );
}
