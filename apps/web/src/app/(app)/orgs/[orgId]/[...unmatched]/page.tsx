'use client';

import { cn } from '@docket/ui';
import { buttonVariants } from '@docket/ui/primitives';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { JSX } from 'react';

/**
 * The in-shell "not found" screen for unmatched org-scoped routes.
 *
 * @remarks
 * A catch-all segment under `/orgs/[orgId]/…`. App Router renders the *root* not-found for a
 * truly unmatched URL, which unmounts every nested layout — including the app-shell frame —
 * leaving the user stranded with no rail or sidebar to navigate back. Mounting this catch-all
 * inside the `(app)` route group means any org-scoped path that does not match a real screen
 * still resolves to a page rendered *within* the shell, so the org rail and context sidebar
 * persist and the user always has a way out.
 *
 * It is deliberately the lowest-priority match: every concrete sibling segment
 * (`projects`, `teams`, `my-work`, …) wins over this catch-all, so it only ever renders for
 * paths that have no real screen.
 */
export default function OrgNotFoundPage(): JSX.Element {
  const params = useParams<{ orgId: string }>();
  const orgId = params.orgId;

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="text-on-surface-variant text-xs font-semibold">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">This page doesn&apos;t exist</h1>
      <p className="text-on-surface-variant max-w-sm text-sm leading-relaxed">
        The page you were looking for couldn&apos;t be found. It may have moved, or the link may be
        out of date.
      </p>
      <Link
        href={`/orgs/${orgId}/my-work`}
        className={cn(buttonVariants({ variant: 'default' }), 'mt-2')}
      >
        Back to My Work
      </Link>
    </div>
  );
}
