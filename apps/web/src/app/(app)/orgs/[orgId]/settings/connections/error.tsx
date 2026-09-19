'use client';

/**
 * Route error boundary for the Integrations settings section.
 *
 * @remarks
 * A render/data failure in this subtree must not blank the whole settings shell or leave the
 * user staring at nothing. The segment retries itself automatically; recovery does not become
 * another task the user has to perform. The error object is logged and never rendered, so the
 * copy stays owned by Docket.
 */
import { EmptyState } from '@docket/ui/components';
import { CircleAlert } from '@docket/ui/icons';
import type { JSX } from 'react';
import { useEffect } from 'react';

import { RegionFrame } from '@/components/feedback';

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
    <RegionFrame size="panel">
      <EmptyState
        frame="none"
        tone="critical"
        icon={CircleAlert}
        title="Couldn’t load your connections"
        body="Reloading this section automatically."
      />
    </RegionFrame>
  );
}
