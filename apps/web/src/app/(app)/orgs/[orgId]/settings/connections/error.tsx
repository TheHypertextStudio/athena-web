'use client';

/**
 * Route error boundary for the Integrations settings section.
 *
 * @remarks
 * A render/data failure in this subtree must not blank the whole settings shell or leave the
 * user staring at nothing — it renders a calm, recoverable message with a Retry that re-runs the
 * segment (`reset`). Mirrors the connector philosophy: surface the failure honestly, never
 * swallow it.
 */
import type { JSX } from 'react';
import { useEffect } from 'react';

/** The Integrations section error boundary. */
export default function IntegrationsSettingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): JSX.Element {
  useEffect(() => {
    console.error('[integrations] section error', error);
  }, [error]);

  return (
    <div
      role="alert"
      className="border-outline-variant flex flex-col items-start gap-3 rounded-lg border p-4"
    >
      <div className="flex flex-col gap-1">
        <p className="text-on-surface text-body font-medium">Couldn’t load your integrations</p>
        <p className="text-on-surface-variant text-xs">
          {error.message || 'Something went wrong while loading this section.'}
        </p>
      </div>
      <button
        type="button"
        onClick={reset}
        className="focus-visible:ring-ring text-primary hover:bg-surface-container-high text-body rounded-md px-3 py-1.5 font-medium transition-colors outline-none focus-visible:ring-1"
      >
        Try again
      </button>
    </div>
  );
}
