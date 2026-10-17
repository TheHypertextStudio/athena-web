'use client';

import type { AthenaMailOutboxOut } from '@docket/athena/athena-mail-contract';
import { Badge, Skeleton, Surface, Text } from '@docket/ui/primitives';
import { type JSX } from 'react';
import Link from '@/components/docket-link';
import { useLiveApiQuery } from '@/lib/query';
import { mailOutboxDef } from './mail-query-defs';

const STATUS_LABELS: Readonly<Record<AthenaMailOutboxOut['status'], string>> = {
  queued: 'Queued',
  sending: 'Sending',
  sent: 'Provider accepted',
  delivered: 'Delivered',
  bounced: 'Bounced',
  failed: 'Failed',
  uncertain: 'Needs delivery review',
  canceled: 'Canceled',
};
const RECOVERY_COPY: Partial<Readonly<Record<AthenaMailOutboxOut['status'], string>>> = {
  sent: 'The email provider accepted this message. Delivery has not been confirmed.',
  bounced: 'This email could not be delivered. Check the recipient address before trying again.',
  failed: 'This email could not be sent. Check your email settings and ask Athena to try again.',
  uncertain: 'Delivery is uncertain. Athena will not automatically resend and risk a duplicate.',
  canceled: 'This email was canceled before sending.',
};

/** Outgoing email receipts with provider acceptance separate from recipient delivery. */
export function MailOutbox(): JSX.Element | null {
  const outboxQ = useLiveApiQuery(mailOutboxDef(), 5_000);
  if (outboxQ.isPending) return <Skeleton className="h-16 w-full rounded-xl" />;
  if (outboxQ.error)
    return (
      <Text as="p" token="body-small" tone="error" role="alert">
        Could not load outgoing email. Try again when you reconnect.
      </Text>
    );
  const messages = outboxQ.data.items;
  return (
    <Surface tone="card" shape="medium" pad="roomy" className="flex flex-col gap-3">
      <Text as="h2" token="title-small">
        Outgoing email
      </Text>
      {messages.length === 0 ? (
        <Text as="p" token="body-small" tone="muted">
          Replies and approved emails will appear here. Approval requests appear in Athena.
        </Text>
      ) : (
        <ul className="flex flex-col gap-4">
          {messages.map((message) => (
            <OutgoingMessage key={message.id} message={message} />
          ))}
        </ul>
      )}
    </Surface>
  );
}

function OutgoingMessage({ message }: { readonly message: AthenaMailOutboxOut }): JSX.Element {
  return (
    <li className="flex min-w-0 flex-col gap-1">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Text token="body-medium" className="min-w-0 break-words">
          {message.subject || '(No subject)'}
        </Text>
        <Badge variant="secondary">{STATUS_LABELS[message.status]}</Badge>
      </div>
      <Text as="p" token="body-small" tone="muted" className="break-all">
        To {message.toAddress}
      </Text>
      {RECOVERY_COPY[message.status] ? (
        <Text as="p" token="body-small" tone="muted">
          {RECOVERY_COPY[message.status]}
        </Text>
      ) : null}
      {message.sessionId ? (
        <Link
          href={`/athena?session=${encodeURIComponent(message.sessionId)}`}
          className="text-primary text-body-small underline"
        >
          Open Athena
        </Link>
      ) : null}
    </li>
  );
}
