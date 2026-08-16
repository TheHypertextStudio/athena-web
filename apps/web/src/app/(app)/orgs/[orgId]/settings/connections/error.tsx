'use client';

/**
 * Route error boundary for the Integrations settings section.
 *
 * @remarks
 * A render/data failure in this subtree must not blank the whole settings shell or leave the
 * user staring at nothing. The segment retries itself automatically; recovery does not become
 * another task the user has to perform.
 */
import type { JSX } from 'react';
import { useEffect } from 'react';

import { userErrorMessage } from '@/lib/problem';

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
  useEffect(() => {
    const timer = window.setTimeout(reset, 3_000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [reset]);

  return (
    <div
      role="alert"
      className="bg-surface-container-low flex flex-col items-start gap-1 rounded-xl p-4"
    >
      <div className="flex flex-col gap-1">
        <p className="text-on-surface text-label-large">Couldn’t load your connections</p>
        <p className="text-on-surface-variant text-body-small">
          {userErrorMessage(error, 'Something went wrong while loading this section.')}
        </p>
        <p className="text-on-surface-variant text-body-small">
          We&apos;re reloading it automatically.
        </p>
      </div>
    </div>
  );
}
