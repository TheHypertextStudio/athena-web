'use client';

/**
 * `settings` — the email-to-task enablement section, shown under **Automations**.
 *
 * @remarks
 * The thin composition for the mail-ingest workflow: it reads the org's mail connections via
 * {@link useMailIngestList} and renders one {@link MailIngestRow} per connected inbox, with an
 * explanatory empty state pointing at Connections when none is linked. This lives with the rules it
 * drives (Automations), not with the connection plumbing (Connections): turning email into tasks is
 * a *workflow*, a different concern from linking the inbox itself.
 * See `docs/engineering/specs/email-to-task.md`.
 */
import NextLink from 'next/link';
import type { JSX } from 'react';

import { Skeleton } from '@docket/ui/primitives';

import { MailIngestRow } from './mail-ingest-row';
import { useMailIngestList } from './use-mail-ingest-controller';

/** Props for {@link MailIngestSection}. */
export interface MailIngestSectionProps {
  orgId: string;
  canManage: boolean;
}

/** The email-to-task section on the Automations page. */
export function MailIngestSection({ orgId, canManage }: MailIngestSectionProps): JSX.Element {
  const { loading, connected, connectionsHref } = useMailIngestList(orgId);

  return (
    <section aria-label="Email to task" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-on-surface text-title-small font-medium">Turn email into tasks</h2>
        <p className="text-on-surface-variant text-body-medium max-w-prose">
          When on, Athena reads new mail from a connected inbox and proposes tasks in triage —
          strictly opt-in. Enabling it seeds the default rules below.
        </p>
      </div>

      {loading ? (
        <Skeleton className="h-20 w-full rounded-lg" />
      ) : connected.length === 0 ? (
        <div className="bg-surface-container-low text-on-surface-variant flex flex-col gap-1 rounded-lg px-4 py-3">
          <p className="text-on-surface text-sm font-medium">No inbox connected yet</p>
          <p className="text-xs">
            Connect Gmail in{' '}
            <NextLink
              href={connectionsHref}
              className="text-on-surface font-medium underline-offset-2 hover:underline"
            >
              Connections
            </NextLink>{' '}
            to turn its mail into task suggestions.
          </p>
        </div>
      ) : (
        connected.map((integration) => (
          <MailIngestRow
            key={integration.id}
            orgId={orgId}
            integration={integration}
            canManage={canManage}
          />
        ))
      )}
    </section>
  );
}
