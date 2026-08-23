'use client';

/**
 * The "email Athena received" section on a task, project, or initiative.
 *
 * @remarks
 * One component for all three entity kinds, because a received message is a context object and
 * context objects hang off work through the same generic attachment table regardless of what the
 * work is. Mounting it on an entity surface is a two-line change with no per-kind branching, which
 * is exactly the property the requirement asked for: attachable "to stuff", not to a mail view.
 *
 * It renders nothing at all when there is nothing attached — an empty section on every task in the
 * product would be noise for a capability most tasks never use. The affordance to attach lives on
 * the message, not here, so this section stays a read.
 */
import { Mail } from '@docket/ui/icons';
import { ControlGroup, Text } from '@docket/ui/primitives';
import Link from '@/components/docket-link';
import type { JSX } from 'react';

import { api } from '@/lib/api';
import { apiQueryOptions, STALE } from '@/lib/query-core';
import { useApiQuery } from '@/lib/query';

/** The entity kinds a received message can be attached to. */
export type MailAttachmentSubject = 'task' | 'project' | 'initiative';

/** Props for {@link MailAttachmentsPanel}. */
export interface MailAttachmentsPanelProps {
  /** Which kind of entity is being viewed. */
  readonly subjectType: MailAttachmentSubject;
  /** That entity's id. */
  readonly subjectId: string;
  /** The workspace it lives in. */
  readonly organizationId: string;
}

/** Format a received instant compactly. */
function receivedLabel(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * List the Athena-received messages attached to one entity.
 *
 * @param props - See {@link MailAttachmentsPanelProps}.
 * @returns the section, or `null` when nothing is attached.
 */
export function MailAttachmentsPanel({
  subjectType,
  subjectId,
  organizationId,
}: MailAttachmentsPanelProps): JSX.Element | null {
  const attachedQ = useApiQuery(
    apiQueryOptions(
      ['me', 'athena', 'mail', 'attached', subjectType, subjectId] as const,
      () =>
        api.v1.me.athena.mail.attached.$get({
          query: { subjectType, subjectId, organizationId },
        }),
      'Could not load the email attached to this item.',
      { staleTime: STALE.volatile, enabled: subjectId.length > 0 && organizationId.length > 0 },
    ),
  );

  const messages = attachedQ.data?.items ?? [];
  if (messages.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <ControlGroup controlSize="xs">
        <Mail aria-hidden="true" className="text-on-surface-variant" />
        <Text token="title-small">Email</Text>
      </ControlGroup>
      <ul className="flex flex-col gap-1">
        {messages.map((message) => (
          <li key={message.id}>
            <Link
              href={`/athena/mail/${message.id}`}
              className="hover:bg-surface-container-high flex h-9 cursor-pointer items-center gap-2 rounded-md px-2"
            >
              <Text token="label-medium" truncate className="max-w-40 shrink-0">
                {message.fromName ?? message.fromAddress}
              </Text>
              <Text token="body-small" truncate className="min-w-0 flex-1">
                {message.title}
              </Text>
              <Text token="label-small" tone="muted" numeric className="shrink-0">
                {receivedLabel(message.occurredAt)}
              </Text>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
