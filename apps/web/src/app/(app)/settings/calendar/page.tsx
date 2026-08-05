'use client';

import type { JSX } from 'react';

import CalendarSettingsPage from '@/app/(app)/orgs/[orgId]/settings/calendar/page';
import { usePersonalWorkspaceId } from '@/components/settings/use-personal-workspace-id';

/**
 * The global caller-owned Calendar destination.
 *
 * @remarks
 * The workspace-scoped page it reuses took a `params` promise purely to satisfy Next's page
 * contract and threw the value away, so this had to manufacture one. Both now read the URL through
 * `@/lib/app-location`, and this is a plain reuse of the same component.
 */
export default function GlobalCalendarSettingsPage(): JSX.Element {
  const orgId = usePersonalWorkspaceId();
  if (!orgId) {
    return <p className="text-on-surface-variant text-body-medium">Loading calendar settings…</p>;
  }
  return <CalendarSettingsPage />;
}
