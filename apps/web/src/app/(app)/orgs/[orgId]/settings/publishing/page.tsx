'use client';

import { use, type JSX } from 'react';

import { PublishingSettings } from '@/components/publishing/publishing-settings';

/**
 * Settings → Publishing: where this workspace's published pages answer on the web.
 *
 * @remarks
 * A thin route wrapper. The section is administrator-only in three independent places, which is
 * the point: the nav hides it for non-admins, this surface renders no controls for them, and the
 * API returns 403 for every underlying write regardless of what any client does (CORE-29).
 *
 * @param props - The dynamic route params.
 * @returns The publishing settings section.
 */
export default function PublishingSettingsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}): JSX.Element {
  const { orgId } = use(params);
  return <PublishingSettings orgId={orgId} />;
}
