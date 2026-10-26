'use client';

import { ChevronLeft } from '@docket/ui/icons';
import { focusRing } from '@docket/ui/primitives';
import type { JSX } from 'react';
import Link from '@/components/docket-link';

/** Return to the project collection without conflating a program relationship with work identity. */
export function ProjectBreadcrumb({
  orgId,
  projectLabel,
}: {
  readonly orgId: string;
  readonly projectLabel: string;
}): JSX.Element {
  return (
    <nav
      aria-label="Breadcrumb"
      className="no-print text-on-surface-variant text-body-medium min-w-0"
    >
      <Link
        href={`/orgs/${orgId}/projects`}
        className={`${focusRing} hover:text-on-surface inline-flex min-h-5 min-w-0 items-center gap-2 pointer-coarse:min-h-10`}
      >
        <ChevronLeft className="size-4 shrink-0" aria-hidden />
        <span className="truncate">{projectLabel}</span>
      </Link>
    </nav>
  );
}
