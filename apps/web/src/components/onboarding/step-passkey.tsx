'use client';

import type { JSX } from 'react';

/** The optional passkey step for accounts created through another provider. */
export function StepPasskey(): JSX.Element {
  return (
    <p className="text-on-surface-variant text-body-medium">
      Add a passkey for this device, or skip and add one later in Settings → Security.
    </p>
  );
}
