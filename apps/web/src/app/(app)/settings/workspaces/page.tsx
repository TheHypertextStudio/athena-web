'use client';

import type { JSX } from 'react';
import Link from 'next/link';
import { Button } from '@docket/ui/primitives';

import { useActiveOrg } from '@/components/active-org';
import { SectionHeader } from '@/components/settings/section-header';

/** The global workspace switchboard and administration entry point. */
export default function GlobalWorkspacesSettingsPage(): JSX.Element {
  const { orgs } = useActiveOrg();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex max-w-2xl items-start justify-between gap-4">
        <SectionHeader
          title="Workspaces"
          description="Choose a workspace and manage its settings."
        />
        <Button asChild>
          <Link href="/workspaces/new">New workspace</Link>
        </Button>
      </div>
      <div className="border-outline-variant flex flex-col divide-y rounded-lg border">
        {orgs.map((workspace) => (
          <Link
            key={workspace.id}
            href={`/orgs/${workspace.id}/settings/general`}
            className="hover:bg-surface-container-high focus-visible:ring-ring flex items-center justify-between gap-4 px-4 py-3 outline-none focus-visible:ring-2"
          >
            <span className="flex min-w-0 flex-col">
              <span className="text-on-surface truncate text-sm font-medium">{workspace.name}</span>
              <span className="text-on-surface-variant text-xs">
                {workspace.isPersonal ? 'Personal workspace' : 'Shared workspace'}
              </span>
            </span>
            <span className="text-on-surface-variant text-xs">Open settings</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
