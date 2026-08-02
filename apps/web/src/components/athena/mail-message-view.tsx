'use client';

/**
 * One received message, read as a context object.
 *
 * @remarks
 * The page a permalink from the activity stream, from Athena's conversation, or from a task's
 * attachment list lands on. It shows the envelope, the body, and — the part that matters — what
 * this message is attached to, with the affordance to attach it somewhere else. The plain-text
 * body is rendered rather than the HTML one on purpose: rendering sender-supplied HTML inside the
 * app would hand a stranger a styling and tracking surface inside somebody's workspace.
 */
import { ArrowRight, Mail, Plus } from '@docket/ui/icons';
import { Badge, Button, ControlGroup, Skeleton, Text, Toolbar } from '@docket/ui/primitives';
import Link from 'next/link';
import { type JSX, useState } from 'react';

import { userErrorMessage } from '@/lib/problem';
import { useApiQuery } from '@/lib/query';

import { MailAttachDialog } from './mail-attach-dialog';
import { mailAttachmentsDef, mailMessageDef } from './mail-query-defs';

/** Props for {@link MailMessageView}. */
export interface MailMessageViewProps {
  /** The received message's id. */
  readonly messageId: string;
}

/** Format an instant with its full date, in the reader's own zone. */
function receivedLabel(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/**
 * Render one received message in full.
 *
 * @param props - See {@link MailMessageViewProps}.
 * @returns the message surface.
 */
export function MailMessageView({ messageId }: MailMessageViewProps): JSX.Element {
  const messageQ = useApiQuery(mailMessageDef(messageId));
  const targetsQ = useApiQuery(mailAttachmentsDef(messageId));
  const [attaching, setAttaching] = useState(false);

  const error = messageQ.error
    ? userErrorMessage(messageQ.error, 'Could not load that message.')
    : null;

  if (error) {
    return (
      <div className="p-4">
        <Text as="p" token="body-small" tone="error" role="alert">
          {error}
        </Text>
      </div>
    );
  }
  if (messageQ.isPending || !messageQ.data) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <Skeleton className="h-8 w-2/3 rounded-md" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  const message = messageQ.data;
  const targets = targetsQ.data?.items ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto p-4">
      <Toolbar
        leading={
          <Link href="/athena/mail" className="cursor-pointer">
            <ControlGroup controlSize="sm">
              <Mail aria-hidden="true" className="text-on-surface-variant" />
              <Text token="label-large" tone="muted">
                Athena’s inbox
              </Text>
            </ControlGroup>
          </Link>
        }
        trailing={
          <Button
            variant="secondary"
            controlSize="sm"
            onClick={() => {
              setAttaching(true);
            }}
          >
            <Plus aria-hidden="true" />
            Attach to work
          </Button>
        }
      />

      <div className="flex flex-col gap-2">
        <Text as="h1" token="headline-small">
          {message.title}
        </Text>
        <ControlGroup controlSize="xs" wrap>
          <Text token="body-small">
            {message.fromName
              ? `${message.fromName} <${message.fromAddress}>`
              : message.fromAddress}
          </Text>
          <Text token="body-small" tone="muted">
            to {message.toAddress}
          </Text>
          <Text token="label-small" tone="muted" numeric>
            {receivedLabel(message.occurredAt)}
          </Text>
        </ControlGroup>
      </div>

      {targets.length > 0 ? (
        <ControlGroup controlSize="xs" wrap>
          <Text token="label-small" tone="muted">
            Attached to
          </Text>
          {targets.map((target) => (
            <Badge key={target.attachmentId} variant="secondary">
              {target.subjectTitle}
            </Badge>
          ))}
        </ControlGroup>
      ) : null}

      {message.attachments.length > 0 ? (
        <ControlGroup controlSize="xs" wrap>
          <Text token="label-small" tone="muted">
            Files
          </Text>
          {message.attachments.map((file) => (
            <Badge key={file.id}>{file.filename}</Badge>
          ))}
        </ControlGroup>
      ) : null}

      <div className="bg-surface-container-low rounded-xl px-4 py-4">
        {message.content ? (
          <Text as="p" token="body-medium" className="whitespace-pre-wrap">
            {message.content}
          </Text>
        ) : (
          <Text as="p" token="body-small" tone="muted">
            The message body has not been retrieved. The envelope above is what arrived.
          </Text>
        )}
      </div>

      {message.streamEventId ? (
        <Link href="/stream" className="w-fit cursor-pointer">
          <ControlGroup controlSize="sm">
            <Text token="label-large" tone="accent">
              See this in your activity stream
            </Text>
            <ArrowRight aria-hidden="true" className="text-primary" />
          </ControlGroup>
        </Link>
      ) : null}

      <MailAttachDialog
        open={attaching}
        onOpenChange={setAttaching}
        messageId={message.id}
        messageTitle={message.title}
        defaultOrganizationId={message.organizationId}
      />
    </div>
  );
}
