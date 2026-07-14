'use client';

import { useMemo, type JSX } from 'react';

import CalendarSettingsPage from '@/app/(app)/orgs/[orgId]/settings/calendar/page';
import { usePersonalWorkspaceId } from '@/components/settings/use-personal-workspace-id';

/** The global caller-owned Calendar destination. */
export default function GlobalCalendarSettingsPage(): JSX.Element {
  const orgId = usePersonalWorkspaceId();
  if (!orgId) {
    return <p className="text-on-surface-variant text-body">Loading calendar settings…</p>;
  }
  const params = useMemo(() => Promise.resolve({ orgId }), [orgId]);
  return <CalendarSettingsPage params={params} />;
}
