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

import { EmptyState } from '@docket/ui/components';
import { Inbox } from '@docket/ui/icons';
import { Button, Skeleton } from '@docket/ui/primitives';

import { MailIngestRow } from './mail-ingest-row';
import { SettingsGroup } from './settings-group';
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
    <SettingsGroup
      title="Email to tasks"
      description="Athena reads new mail and suggests tasks in your inbox. Turning it on adds the default rules below."
      body="rows"
    >
      {/* placeholder: which inboxes are connected and whether mail ingest is switched on for
          them. The heading, the explanation and the "no inbox connected" copy are static. */}
      {loading ? (
        <Skeleton className="h-20 w-full rounded-xl" />
      ) : connected.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No inbox connected yet"
          body="Connect Gmail and Docket turns the mail that needs doing into task suggestions you can accept or ignore."
          className="border-none bg-transparent"
          action={
            <Button asChild variant="outline">
              <NextLink href={connectionsHref}>Connect Gmail</NextLink>
            </Button>
          }
        />
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
    </SettingsGroup>
  );
}
