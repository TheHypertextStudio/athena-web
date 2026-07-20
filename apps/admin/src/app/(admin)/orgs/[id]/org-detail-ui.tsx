'use client';

import { Skeleton } from '@docket/ui/primitives';
import type { JSX } from 'react';

/** A labeled read-only field in the overview card. */
export function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-on-surface-variant text-xs tracking-wide uppercase">{label}</span>
      <span
        className={`text-body-medium ${mono ? 'truncate font-mono text-xs' : ''}`}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

/** A loading placeholder for the org detail screen. */
export function DetailSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-8 w-64 rounded-md" />
      <Skeleton className="h-32 w-full rounded-lg" />
      <Skeleton className="h-48 w-full rounded-lg" />
    </div>
  );
}
