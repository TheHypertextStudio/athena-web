'use client';

import { ChevronRight } from '@docket/ui/icons';
import { focusRing } from '@docket/ui/primitives';
import { cn } from '@docket/ui/lib/utils';
import type { JSX } from 'react';
import Link from '@/components/docket-link';

/** Navigation to a project's real containing program, or its workspace collection. */
export function ProjectBreadcrumb({
  orgId,
  projectLabel,
  programLabel,
  program,
}: {
  readonly orgId: string;
  readonly projectLabel: string;
  readonly programLabel: string;
  readonly program?: { readonly id: string; readonly name: string } | null | undefined;
}): JSX.Element {
  const linkClass = `${focusRing} hover:text-on-surface pointer-coarse:min-h-10 pointer-coarse:min-w-10 inline-flex min-h-5 min-w-0 items-center break-words`;
  return (
    <nav
      aria-label="Breadcrumb"
      className="no-print text-on-surface-variant text-body-medium @container"
    >
      <ol className="flex min-w-0 flex-wrap items-center gap-x-2">
        <li className={cn('min-w-0', program && 'hidden @sm:block')}>
          <Link href={`/orgs/${orgId}/${program ? 'programs' : 'projects'}`} className={linkClass}>
            {program ? programLabel : projectLabel}
          </Link>
        </li>
        {program ? (
          <li className="flex max-w-full min-w-0 items-center gap-2">
            <ChevronRight className="hidden size-4 shrink-0 @sm:block" aria-hidden />
            <Link href={`/orgs/${orgId}/programs/${program.id}`} className={linkClass}>
              {program.name}
            </Link>
          </li>
        ) : null}
      </ol>
    </nav>
  );
}
