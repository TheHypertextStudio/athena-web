'use client';

/**
 * Athena's inbox: the address people write to, and the messages that arrived there.
 *
 * @remarks
 * Two things a person needs from this surface, and nothing else. The first is the address —
 * useless if it is hidden, so it is the first thing on the page with a one-press copy. The
 * second is what has arrived, as a list of *context objects*: each row reads sender, subject,
 * time and what it is already attached to, because "what is this and where does it belong" is
 * the only question anyone asks of a received message.
 *
 * There is deliberately no reply, no folders, and no unread count. Docket is not a mail client;
 * these messages are context Athena reads and work hangs off. Everything that happens *to* a
 * message happens through attachment, which is why the only action on a row is "Attach to work".
 *
 * When no receiving domain is configured the surface says so plainly rather than printing an
 * address that would bounce — a promise the product cannot keep is worse than an absent feature.
 */
import { Inbox, Link as LinkIcon, Mail, Plus, Trash2 } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { Badge, Button, ControlGroup, Skeleton, Text, Toolbar } from '@docket/ui/primitives';
import Link from 'next/link';
import { type JSX, useState } from 'react';

import { userErrorMessage } from '@/lib/problem';
import { unwrap } from '@/lib/query-core';
import { useApiListQuery, useApiMutation, useApiQuery } from '@/lib/query';

import { MailAttachDialog } from './mail-attach-dialog';
import {
  detachMessage,
  mailAttachmentsDef,
  mailAttachmentsKey,
  mailListDef,
  mailListKey,
  mailMessageKey,
  mailboxDef,
} from './mail-query-defs';

/** One received message as the list renders it. */
type MailRow = NonNullable<ReturnType<typeof useMailList>['data']>['items'][number];

/** The received-message list query, extracted so the row type can be derived from it. */
function useMailList() {
  return useApiListQuery(mailListDef());
}

/** Format an instant the way the rest of the app reads times: date plus time, reader's zone. */
function receivedLabel(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** The card that shows (and copies) the caller's Athena address. */
function AddressCard(): JSX.Element {
  const mailboxQ = useApiQuery(mailboxDef());
  const [copied, setCopied] = useState(false);
  const error = mailboxQ.error
    ? userErrorMessage(mailboxQ.error, 'Could not load your Athena inbox address.')
    : null;

  if (mailboxQ.isPending) return <Skeleton className="h-20 w-full rounded-xl" />;
  if (error) {
    return (
      <Text as="p" token="body-small" tone="error" role="alert">
        {error}
      </Text>
    );
  }

  const mailbox = mailboxQ.data;
  const address = mailbox?.address ?? null;

  return (
    <div className="bg-surface-container-low flex flex-col gap-2 rounded-xl px-4 py-4">
      <ControlGroup controlSize="sm">
        <Mail aria-hidden="true" className="text-on-surface-variant" />
        <Text token="title-small">Athena’s address</Text>
      </ControlGroup>
      {address ? (
        <>
          <Text as="p" token="body-large" className="font-mono break-all">
            {address}
          </Text>
          <div className="flex items-center justify-between gap-3">
            <Text as="p" token="body-small" tone="muted">
              Anything sent here reaches Athena directly. No mailbox to connect, nothing to import.
            </Text>
            <Button
              variant="secondary"
              controlSize="sm"
              className="shrink-0"
              onClick={() => {
                void navigator.clipboard.writeText(address).then(() => {
                  setCopied(true);
                });
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </>
      ) : (
        <Text as="p" token="body-small" tone="muted">
          Athena does not have a receiving domain yet, so there is no address to give out. Once one
          is configured, your address appears here.
        </Text>
      )}
    </div>
  );
}

/** The list of entities one message is attached to, with a way to detach each. */
function AttachedTargets({ messageId }: { readonly messageId: string }): JSX.Element | null {
  const targetsQ = useApiQuery(mailAttachmentsDef(messageId));
  const detachM = useApiMutation({
    mutationFn: (attachmentId: string) =>
      unwrap(() => detachMessage(messageId, attachmentId), 'Could not detach this message.'),
    invalidateKeys: [mailAttachmentsKey(messageId), mailMessageKey(messageId), mailListKey],
  });

  const targets = targetsQ.data?.items ?? [];
  if (targets.length === 0) return null;

  return (
    <ul className="flex flex-wrap items-center gap-1.5">
      {targets.map((target) => (
        <li key={target.attachmentId}>
          <ControlGroup
            controlSize="xs"
            className="bg-surface-container-high h-6 rounded-md px-2 py-0"
          >
            <LinkIcon aria-hidden="true" className="text-on-surface-variant" />
            <Text token="label-small" truncate className="max-w-52">
              {target.subjectTitle}
            </Text>
            <button
              type="button"
              aria-label={`Detach from ${target.subjectTitle}`}
              disabled={detachM.isPending}
              className="text-on-surface-variant hover:text-on-surface cursor-pointer"
              onClick={() => {
                detachM.mutate(target.attachmentId);
              }}
            >
              <Trash2 aria-hidden="true" className="size-3.5" />
            </button>
          </ControlGroup>
        </li>
      ))}
    </ul>
  );
}

/** One received message. */
function MailRowView({
  message,
  onAttach,
}: {
  readonly message: MailRow;
  readonly onAttach: () => void;
}): JSX.Element {
  return (
    <li
      className={cn(
        'group/row border-outline-variant/40 flex flex-col gap-1.5 border-b px-4 py-3 last:border-b-0',
      )}
    >
      <div className="flex min-w-0 items-baseline gap-2">
        <Text token="label-large" truncate className="max-w-64 min-w-0 shrink-0">
          {message.fromName ?? message.fromAddress}
        </Text>
        <Link
          href={`/athena/mail/${message.id}`}
          className="min-w-0 flex-1 cursor-pointer hover:underline"
        >
          <Text token="body-medium" truncate>
            {message.title}
          </Text>
        </Link>
        <Text token="label-small" tone="muted" numeric className="shrink-0">
          {receivedLabel(message.occurredAt)}
        </Text>
      </div>
      {message.snippet ? (
        <Text as="p" token="body-small" tone="muted" className="line-clamp-2">
          {message.snippet}
        </Text>
      ) : message.contentStatus === 'metadata-only' ? (
        <Text as="p" token="body-small" tone="muted">
          The message body has not been retrieved.
        </Text>
      ) : null}
      {/* Wraps rather than overflowing: on a phone the "attached to" chips alone can be wider
          than the row, and a clipped action is worse than a second line. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <div className="min-w-0">
          <AttachedTargets messageId={message.id} />
        </div>
        <ControlGroup controlSize="xs" className="ml-auto shrink-0">
          {message.attachments.length > 0 ? (
            <Badge variant="secondary">
              {message.attachments.length} file{message.attachments.length === 1 ? '' : 's'}
            </Badge>
          ) : null}
          <Button variant="ghost" controlSize="sm" onClick={onAttach}>
            <Plus aria-hidden="true" />
            Attach to work
          </Button>
        </ControlGroup>
      </div>
    </li>
  );
}

/**
 * Athena's inbox surface.
 *
 * @returns the address card plus the received-message list.
 */
export function MailInbox(): JSX.Element {
  const listQ = useMailList();
  const [attaching, setAttaching] = useState<MailRow | null>(null);

  const error = listQ.error
    ? userErrorMessage(listQ.error, 'Could not load the messages Athena received.')
    : null;
  const messages = listQ.data?.items ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4">
      <Toolbar
        leading={
          <>
            <Inbox aria-hidden="true" className="text-on-surface-variant" />
            <Text as="h1" token="headline-small">
              Athena’s inbox
            </Text>
          </>
        }
        trailing={
          messages.length > 0 ? (
            <Badge variant="secondary">
              {messages.length} message{messages.length === 1 ? '' : 's'}
            </Badge>
          ) : null
        }
      />

      <AddressCard />

      {error ? (
        <Text as="p" token="body-small" tone="error" role="alert">
          {error}
        </Text>
      ) : listQ.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : messages.length === 0 ? (
        <div className="bg-surface-container-low flex flex-col gap-1 rounded-xl px-4 py-6">
          <Text token="title-small">Nothing has arrived yet</Text>
          <Text as="p" token="body-small" tone="muted">
            Forward something to the address above and it will show up here, in your activity
            stream, and in Athena’s conversation.
          </Text>
        </div>
      ) : (
        <ul className="bg-surface-container-low min-h-0 flex-1 overflow-auto rounded-xl">
          {messages.map((message) => (
            <MailRowView
              key={message.id}
              message={message}
              onAttach={() => {
                setAttaching(message);
              }}
            />
          ))}
        </ul>
      )}

      {attaching ? (
        <MailAttachDialog
          open
          onOpenChange={(next) => {
            if (!next) setAttaching(null);
          }}
          messageId={attaching.id}
          messageTitle={attaching.title}
          defaultOrganizationId={attaching.organizationId}
        />
      ) : null}
    </div>
  );
}
