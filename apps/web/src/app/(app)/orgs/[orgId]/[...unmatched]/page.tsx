'use client';

import { useAppParams } from '@/lib/app-location';
import type { JSX } from 'react';

import { AppContentFallback } from '@/components/app-content-fallback';

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
  const params = useAppParams<{ orgId: string }>();
  const orgId = params.orgId;

  return (
    <AppContentFallback
      kind="not-found"
      returnHref={`/orgs/${orgId}/my-work`}
      returnLabel="Back to My Work"
    />
  );
}
