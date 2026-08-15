'use client';

import type { JSX } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { BillingSettings } from '@/components/settings/billing-settings';
import { useAppParams } from '@/lib/app-location';

/** Workspace billing settings route. */
export default function WorkspaceBillingSettingsPage(): JSX.Element {
  const { orgId } = useAppParams<{ orgId: string }>();
  const { activeOrg } = useActiveOrg();
  return <BillingSettings orgId={orgId} isPersonal={activeOrg?.isPersonal ?? false} />;
}
