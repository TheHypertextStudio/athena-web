'use client';

import type { JSX } from 'react';

import { SectionHeader } from '@/components/settings/section-header';
import { SecurityTab } from '@/components/settings/security-tab';

/** The global caller-owned Security destination. */
export default function GlobalSecuritySettingsPage(): JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Security"
        description="Manage your passkeys, email, active sessions, and recovery codes."
      />
      <SecurityTab />
    </div>
  );
}
