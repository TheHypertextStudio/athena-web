import { Skeleton } from '@docket/ui/primitives';
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
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    );
  }
  if (loadError) {
    return (
      <div
        role="alert"
        className="border-outline-variant bg-surface-container-low text-on-surface-variant flex flex-col gap-1 rounded-lg border p-4"
      >
        <p className="text-on-surface text-body-medium font-medium">
          We couldn&apos;t load connections.
        </p>
        <p className="text-body-medium">We&apos;ll keep trying automatically.</p>
      </div>
    );
  }
  return <>{children}</>;
}
