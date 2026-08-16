import { Skeleton } from '@docket/ui/primitives';

import { LoadFailure } from './load-failure';
import type { JSX, ReactNode } from 'react';

/** Props for {@link IntegrationsStatus}. */
export interface IntegrationsStatusProps {
  loading: boolean;
  loadError: string | null;
  /** The resolved content, rendered once neither loading nor errored. */
  children: ReactNode;
}

/**
 * The shared load shell for the Connections and Import panels: a skeleton while the directory
 * loads, a quiet retry notice on error, else the panel's content.
 */
export function IntegrationsStatus({
  loading,
  loadError,
  children,
}: IntegrationsStatusProps): JSX.Element {
  if (loading) {
    // placeholder: which integrations this workspace has connected and the state of each. The
    // first bar stands in for a connected provider's *name*, not a static section heading — the
    // surrounding page renders its own headings before this component is reached.
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    );
  }
  if (loadError) {
    return <LoadFailure message={loadError} retrying />;
  }
  return <>{children}</>;
}
