'use client';

import { useMemo, type JSX } from 'react';

import NotificationsSettingsPage from '@/app/(app)/orgs/[orgId]/settings/notifications/page';
import { usePersonalWorkspaceId } from '@/components/settings/use-personal-workspace-id';

/** The global caller-owned Notifications destination. */
export default function GlobalNotificationsSettingsPage(): JSX.Element {
  const orgId = usePersonalWorkspaceId();
  if (!orgId) {
    return <p className="text-on-surface-variant text-body-medium">Loading notification settings…</p>;
  }
  const params = useMemo(() => Promise.resolve({ orgId }), [orgId]);
  return <NotificationsSettingsPage params={params} />;
}
