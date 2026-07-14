'use client';

/**
 * One actionable row in the cross-org Inbox feed.
 *
 * @remarks
 * Each row is one {@link NotificationOut} that needs a response — an agent approval, a
 * mention, an assignment, a status change. It leads with a type glyph, shows the body
 * `title` (linking to the subject when a deep link exists) plus an optional `summary`, and
 * is org-chipped + time-stamped so the cross-org feed is never ambiguous. Unread rows carry
 * a leading accent dot and a subtle tint; read rows quiet down.
 *
 * Two inline actions live on the trailing edge, both owned by the parent (it holds the RPC +
 * pending/error state, this component just fires the callbacks):
 *
 * - **Approve** — shown only for low-risk `approval_request` rows, one-tap signs off the
 *   agent's work directly from the Inbox.
 * - **Mark read** — shown for any unread row, dismisses it from the attention queue.
 */
import { notificationDeliveryHintsFromBody } from '@docket/notifications';
import type { NotificationOut } from '@docket/types';
import { Check, Mail, MessageSquare } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { Button } from '@docket/ui/primitives';
import Link from 'next/link';
import { type JSX, type ReactNode } from 'react';

import { OrgChip } from '@/components/org-chip';

import { relativeTime } from '../agents/format-time';
import { isApproval, notificationHref, notificationKind } from './notification-meta';

/** Props for {@link NotificationRow}. */
export interface NotificationRowProps {
  /** The notification to render. */
  readonly notification: NotificationOut;
  /** The originating org's display name (for the chip); `null` for org-less notifications. */
  readonly orgName: string | null;
  /** Approve the agent work behind a low-risk approval request (one-tap, from here). */
  readonly onApprove: (id: string) => void;
  /** Mark the notification read, dismissing it from the attention queue. */
  readonly onMarkRead: (id: string) => void;
  /** Whether an action for this row is in flight (disables both inline actions). */
  readonly pending: boolean;
}

/**
 * A single actionable Inbox notification row with inline approve / mark-read actions.
 */
export function NotificationRow({
  notification,
  orgName,
  onApprove,
  onMarkRead,
  pending,
}: NotificationRowProps): JSX.Element {
  const { icon: Icon, label } = notificationKind(notification.type);
  const unread = !notification.readAt;
  const approval = isApproval(notification.type);
  const href = notificationHref(notification);
  const summary = notification.body.summary;
  const deliveryHints = notificationDeliveryHintsFromBody(notification.body);
  const externalDeliveryHints = deliveryHints.filter(
    (hint) =>
      hint.channel !== 'web' && ['sent', 'delivered', 'read', 'acted'].includes(hint.status),
  );

  return (
    <div
      className={cn(
        'border-outline-variant flex items-start gap-3 rounded-lg border px-3 py-3 transition-colors',
        unread ? 'bg-surface-container-low' : 'bg-transparent',
      )}
    >
      {/* Unread accent + type glyph. */}
      <span className="relative mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center">
        <span
          aria-hidden="true"
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-lg',
            approval && unread
              ? 'bg-primary/10 text-primary'
              : 'bg-surface-container text-on-surface-variant',
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        {unread ? (
          <span
            aria-hidden="true"
            className="bg-primary ring-surface-container-low absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2"
          />
        ) : null}
      </span>

      {/* Body. */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-on-surface-variant text-xs font-medium">{label}</span>
          <span className="text-on-surface-variant text-xs">
            {relativeTime(notification.createdAt)}
          </span>
          {unread ? <span className="sr-only">Unread</span> : null}
        </div>

        <TitleLine href={href}>
          <span
            className={cn(
              'text-body-medium',
              unread ? 'text-on-surface font-medium' : 'text-on-surface/80',
            )}
          >
            {notification.body.title}
          </span>
        </TitleLine>

        {summary ? (
          <p className="text-on-surface-variant text-body-medium line-clamp-2">{summary}</p>
        ) : null}

        {externalDeliveryHints.length > 0 ? (
          <div className="text-on-surface-variant flex flex-wrap items-center gap-2 text-xs">
            {externalDeliveryHints.map((hint) => (
              <DeliveryHint key={hint.channel} hint={hint} />
            ))}
          </div>
        ) : null}

        {notification.organizationId ? (
          <div className="mt-0.5">
            <OrgChip
              orgId={notification.organizationId}
              name={orgName ?? `Org ${notification.organizationId.slice(0, 6)}`}
            />
          </div>
        ) : null}
      </div>

      {/* Inline actions. */}
      {unread ? (
        <div className="flex shrink-0 items-center gap-1.5">
          {approval ? (
            <Button
              size="sm"
              disabled={pending}
              onClick={() => {
                onApprove(notification.id);
              }}
            >
              {pending ? 'Approving…' : 'Approve ▸'}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            aria-label="Mark read"
            title="Mark read"
            onClick={() => {
              onMarkRead(notification.id);
            }}
          >
            <Check className="h-4 w-4" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Props for {@link DeliveryHint}. */
interface DeliveryHintProps {
  readonly hint: ReturnType<typeof notificationDeliveryHintsFromBody>[number];
}

/** Compact delivery state shown below service-wide notifications. */
function DeliveryHint({ hint }: DeliveryHintProps): JSX.Element {
  const Icon = hint.channel === 'email' ? Mail : MessageSquare;
  const label =
    hint.channel === 'email'
      ? 'Also emailed'
      : hint.channel === 'sms'
        ? 'Also texted'
        : 'Also sent';
  return (
    <span className="inline-flex items-center gap-1">
      <Icon aria-hidden="true" className="size-3.5" />
      <span>{label}</span>
      {hint.valueMasked ? <span className="font-medium">{hint.valueMasked}</span> : null}
    </span>
  );
}

/** Wrap the title in a focusable link to its subject, or render it inert when none exists. */
function TitleLine({ href, children }: { href: string | null; children: ReactNode }): JSX.Element {
  if (!href) return <span className="block min-w-0 truncate">{children}</span>;
  return (
    <Link
      href={href}
      className="focus-visible:ring-ring block min-w-0 truncate rounded-sm transition-colors hover:underline focus-visible:ring-2 focus-visible:outline-none"
    >
      {children}
    </Link>
  );
}
