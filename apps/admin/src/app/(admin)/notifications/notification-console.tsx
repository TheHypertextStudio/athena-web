import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
} from '@docket/ui/primitives';
import type { JSX, SyntheticEvent } from 'react';

import { EmptyState, ErrorBanner, PageHeader, ROW_CLASS } from '@/components/ui-bits';
import type {
  AdminNotificationEstimate,
  AdminNotificationIntent,
  AdminNotificationPreview,
} from '@/lib/types';
import {
  notificationAudienceSegments,
  type NotificationAnnouncementDraft,
} from './notification-console-model';

/** Minimal delivery row shown in the monitor panel. */
export interface NotificationMonitorDelivery {
  /** Delivery id. */
  readonly id: string;
  /** Delivery channel. */
  readonly channel: string;
  /** Delivery status. */
  readonly status: string;
}

/** Minimal inbound event row shown in the monitor panel. */
export interface NotificationMonitorInboundEvent {
  /** Inbound event id. */
  readonly id: string;
  /** Event channel. */
  readonly channel: string;
  /** Event kind. */
  readonly kind: string;
}

/** Minimal operator audit row shown in the monitor panel. */
export interface NotificationMonitorAuditEvent {
  /** Audit event id. */
  readonly id: string;
  /** Audit event type. */
  readonly type: string;
}

/** Props for {@link NotificationAnnouncementConsole}. */
export interface NotificationAnnouncementConsoleProps {
  /** Notification intents shown in the staff side rail. */
  readonly intents: readonly AdminNotificationIntent[];
  /** Currently selected intent, if any. */
  readonly selectedIntent: AdminNotificationIntent | null;
  /** Audience/channel estimate for the selected intent. */
  readonly estimate: AdminNotificationEstimate | null;
  /** Channel previews for the selected intent. */
  readonly preview: AdminNotificationPreview | null;
  /** Delivery rows for the monitor panel. */
  readonly deliveries: readonly NotificationMonitorDelivery[];
  /** Inbound event rows for the monitor panel. */
  readonly inboundEvents: readonly NotificationMonitorInboundEvent[];
  /** Operator audit rows for the monitor panel. */
  readonly auditEvents: readonly NotificationMonitorAuditEvent[];
  /** Editable compose draft. */
  readonly draft: NotificationAnnouncementDraft;
  /** Action currently in flight, if any. */
  readonly pendingAction: string | null;
  /** Inline error message. */
  readonly error: string | null;
  /** Inline success/status message. */
  readonly statusMessage: string | null;
  /** Update one draft field. */
  readonly onDraftChange: <K extends keyof NotificationAnnouncementDraft>(
    key: K,
    value: NotificationAnnouncementDraft[K],
  ) => void;
  /** Create the draft intent. */
  readonly onCreateDraft: () => void;
  /** Refresh estimate, preview, deliveries, audit, and inbound state. */
  readonly onRefreshReview: () => void;
  /** Send a test copy to the operator. */
  readonly onTestSend: () => void;
  /** Approve a draft/scheduled intent. */
  readonly onApprove: () => void;
  /** Send the selected intent now. */
  readonly onSendNow: () => void;
  /** Cancel the selected intent. */
  readonly onCancel: () => void;
  /** Select an intent from the side rail. */
  readonly onSelectIntent: (id: string) => void;
}

const channels = ['web', 'email', 'sms', 'push'] as const;
/**
 * The staff service-announcement console surface.
 *
 * @remarks
 * This component is intentionally presentational: the routed page owns API calls and state, while
 * this surface keeps the compose, review, and monitor workflow testable without browser globals.
 */
export function NotificationAnnouncementConsole({
  intents,
  selectedIntent,
  estimate,
  preview,
  deliveries,
  inboundEvents,
  auditEvents,
  draft,
  pendingAction,
  error,
  statusMessage,
  onDraftChange,
  onCreateDraft,
  onRefreshReview,
  onTestSend,
  onApprove,
  onSendNow,
  onCancel,
  onSelectIntent,
}: NotificationAnnouncementConsoleProps): JSX.Element {
  const recipientLabel = estimate
    ? `${estimate.recipientCount} recipient${estimate.recipientCount === 1 ? '' : 's'}`
    : 'No estimate';
  const disableSelectedActions = !selectedIntent || pendingAction !== null;

  function submit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    onCreateDraft();
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-8">
      <PageHeader
        title="Service announcements"
        description="Compose, review, send, and monitor operational notifications."
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={pendingAction !== null}
            onClick={onRefreshReview}
          >
            Refresh
          </Button>
        }
      />
      <ErrorBanner message={error} />
      {statusMessage ? (
        <div className="border-outline-variant bg-surface-container-low text-on-surface text-body rounded-lg border px-3 py-2">
          {statusMessage}
        </div>
      ) : null}

      <div className="grid min-h-[42rem] gap-6 xl:grid-cols-[20rem_minmax(0,1fr)]">
        <section className="flex flex-col gap-3" aria-labelledby="notification-list-heading">
          <div className="flex items-center justify-between gap-3">
            <h2 id="notification-list-heading" className="text-body font-medium">
              Recent intents
            </h2>
            <Badge>{intents.length}</Badge>
          </div>
          {intents.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {intents.map((intent) => (
                <li key={intent.id}>
                  <button
                    type="button"
                    className={`${ROW_CLASS} w-full flex-col items-start gap-1 rounded-lg px-3 py-2.5 text-left ${
                      selectedIntent?.id === intent.id ? 'bg-surface-container-highest' : ''
                    }`}
                    onClick={() => {
                      onSelectIntent(intent.id);
                    }}
                  >
                    <span className="text-body line-clamp-2 font-medium">{intent.subject}</span>
                    <span className="text-on-surface-variant text-xs">
                      {intent.status} · {intent.priority}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState message="No notification intents yet." />
          )}
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <ComposeCard
            draft={draft}
            pending={pendingAction === 'create'}
            onDraftChange={onDraftChange}
            onSubmit={submit}
          />
          <AudienceCard estimate={estimate} recipientLabel={recipientLabel} />
          <ChannelsCard estimate={estimate} />
          <PreviewCard preview={preview} />
          <ReviewCard
            selectedIntent={selectedIntent}
            estimate={estimate}
            pendingAction={pendingAction}
            disabled={disableSelectedActions}
            onTestSend={onTestSend}
            onApprove={onApprove}
            onSendNow={onSendNow}
            onCancel={onCancel}
          />
          <MonitorCard
            deliveries={deliveries}
            inboundEvents={inboundEvents}
            auditEvents={auditEvents}
          />
        </div>
      </div>
    </div>
  );
}

function ComposeCard({
  draft,
  pending,
  onDraftChange,
  onSubmit,
}: {
  readonly draft: NotificationAnnouncementDraft;
  readonly pending: boolean;
  readonly onDraftChange: NotificationAnnouncementConsoleProps['onDraftChange'];
  readonly onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
}): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-body">Compose</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <Field label="Title">
            <Input
              value={draft.subject}
              onChange={(event) => {
                onDraftChange('subject', event.target.value);
              }}
              placeholder="Scheduled maintenance tonight"
            />
          </Field>
          <Field label="Body">
            <textarea
              value={draft.bodyText}
              onChange={(event) => {
                onDraftChange('bodyText', event.target.value);
              }}
              className="border-input bg-background text-on-surface placeholder:text-on-surface-variant focus-visible:ring-ring min-h-24 rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
              placeholder="Docket will be briefly unavailable tonight."
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Audience">
              <select
                value={draft.audienceType}
                onChange={(event) => {
                  onDraftChange(
                    'audienceType',
                    event.target.value as NotificationAnnouncementDraft['audienceType'],
                  );
                }}
                className="border-input bg-background text-on-surface focus-visible:ring-ring h-10 rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
              >
                <option value="user">One user</option>
                <option value="users">Specific users</option>
                <option value="segment">Segment</option>
                <option value="all_users">All users</option>
              </select>
            </Field>
            {draft.audienceType === 'segment' ? (
              <Field label="Segment">
                <select
                  value={draft.audienceValue}
                  onChange={(event) => {
                    onDraftChange('audienceValue', event.target.value);
                  }}
                  className="border-input bg-background text-on-surface focus-visible:ring-ring h-10 rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
                >
                  {notificationAudienceSegments.map((segment) => (
                    <option key={segment} value={segment}>
                      {segment}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <Field label={draft.audienceType === 'users' ? 'User ids' : 'User id'}>
                <Input
                  value={draft.audienceValue}
                  disabled={draft.audienceType === 'all_users'}
                  onChange={(event) => {
                    onDraftChange('audienceValue', event.target.value);
                  }}
                  placeholder={draft.audienceType === 'users' ? 'user_1, user_2' : 'user_1'}
                />
              </Field>
            )}
            <Field label="Priority">
              <select
                value={draft.priority}
                onChange={(event) => {
                  onDraftChange(
                    'priority',
                    event.target.value as NotificationAnnouncementDraft['priority'],
                  );
                }}
                className="border-input bg-background text-on-surface focus-visible:ring-ring h-10 rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
              >
                {['low', 'normal', 'high', 'urgent'].map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Reply policy">
              <select
                value={draft.replyPolicy}
                onChange={(event) => {
                  onDraftChange(
                    'replyPolicy',
                    event.target.value as NotificationAnnouncementDraft['replyPolicy'],
                  );
                }}
                className="border-input bg-background text-on-surface focus-visible:ring-ring h-10 rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
              >
                {['none', 'staff_inbox', 'org_admins', 'automation'].map((policy) => (
                  <option key={policy} value={policy}>
                    {policy}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Channels">
              <div className="border-outline-variant grid grid-cols-2 gap-2 rounded-md border p-2">
                {channels.map((channel) => (
                  <label key={channel} className="flex items-center gap-2 text-sm font-normal">
                    <input
                      type="checkbox"
                      checked={draft.channels.includes(channel)}
                      onChange={() => {
                        onDraftChange('channels', toggleChannel(draft.channels, channel));
                      }}
                    />
                    {channel}
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Schedule">
              <Input
                type="datetime-local"
                value={draft.scheduledAt}
                onChange={(event) => {
                  onDraftChange('scheduledAt', event.target.value);
                }}
              />
            </Field>
          </div>
          <Button
            type="submit"
            disabled={pending || draft.subject.trim() === '' || draft.bodyText.trim() === ''}
          >
            {pending ? 'Creating…' : 'Create draft'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function toggleChannel(
  selected: readonly NotificationAnnouncementDraft['channels'][number][],
  channel: NotificationAnnouncementDraft['channels'][number],
): readonly NotificationAnnouncementDraft['channels'][number][] {
  return selected.includes(channel)
    ? selected.filter((item) => item !== channel)
    : [...selected, channel];
}

function AudienceCard({
  estimate,
  recipientLabel,
}: {
  readonly estimate: AdminNotificationEstimate | null;
  readonly recipientLabel: string;
}): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-body">Audience</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-3xl font-semibold tabular-nums">{recipientLabel}</p>
        {estimate?.approvalRequired ? (
          <Badge variant="destructive">Approval required</Badge>
        ) : (
          <Badge variant="secondary">No approval gate</Badge>
        )}
        {estimate?.suppressions.length ? (
          <ul className="flex flex-col gap-1">
            {estimate.suppressions.map((suppression) => (
              <li
                key={`${suppression.channel ?? 'any'}:${suppression.reason}`}
                className="text-on-surface-variant text-sm"
              >
                {suppression.count} {suppression.channel ?? 'channel'} ·{' '}
                {formatReason(suppression.reason)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-on-surface-variant text-sm">No suppressions estimated.</p>
        )}
      </CardContent>
    </Card>
  );
}

function ChannelsCard({
  estimate,
}: {
  readonly estimate: AdminNotificationEstimate | null;
}): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-body">Channels</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-4 gap-2 text-center text-xs">
          {channels.map((channel) => {
            const counts = estimate?.channelCounts[channel];
            return (
              <div key={channel} className="border-outline-variant rounded-md border p-2">
                <p className="font-medium">{channel}</p>
                <p className="text-on-surface-variant mt-1">send {counts?.send ?? 0}</p>
                <p className="text-on-surface-variant">delay {counts?.delay ?? 0}</p>
                <p className="text-on-surface-variant">suppress {counts?.suppress ?? 0}</p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function PreviewCard({
  preview,
}: {
  readonly preview: AdminNotificationPreview | null;
}): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-body">Preview</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        {preview ? (
          <>
            <PreviewPane label="Web" title={preview.web?.title} body={preview.web?.body} />
            <PreviewPane label="Email" title={preview.email?.subject} body={preview.email?.text} />
            <PreviewPane label="SMS" body={preview.sms?.text} />
            <PreviewPane label="Push" title={preview.push?.title} body={preview.push?.body} />
          </>
        ) : (
          <p className="text-on-surface-variant text-sm">Select an intent to preview channels.</p>
        )}
      </CardContent>
    </Card>
  );
}

function ReviewCard({
  selectedIntent,
  estimate,
  pendingAction,
  disabled,
  onTestSend,
  onApprove,
  onSendNow,
  onCancel,
}: {
  readonly selectedIntent: AdminNotificationIntent | null;
  readonly estimate: AdminNotificationEstimate | null;
  readonly pendingAction: string | null;
  readonly disabled: boolean;
  readonly onTestSend: () => void;
  readonly onApprove: () => void;
  readonly onSendNow: () => void;
  readonly onCancel: () => void;
}): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-body">Review</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid gap-2 text-sm">
          <FieldValue label="Status" value={selectedIntent?.status ?? 'None selected'} />
          <FieldValue label="Category" value={selectedIntent?.category ?? 'service_announcement'} />
          <FieldValue
            label="Approval"
            value={estimate?.approvalRequired ? 'Required' : 'Not required'}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={disabled} onClick={onTestSend}>
            {pendingAction === 'test' ? 'Sending…' : 'Test send'}
          </Button>
          <Button variant="outline" disabled={disabled} onClick={onApprove}>
            {pendingAction === 'approve' ? 'Approving…' : 'Approve'}
          </Button>
          <Button disabled={disabled} onClick={onSendNow}>
            {pendingAction === 'send' ? 'Sending…' : 'Send now'}
          </Button>
          <Button variant="outline" disabled={disabled} onClick={onCancel}>
            {pendingAction === 'cancel' ? 'Canceling…' : 'Cancel'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MonitorCard({
  deliveries,
  inboundEvents,
  auditEvents,
}: {
  readonly deliveries: readonly NotificationMonitorDelivery[];
  readonly inboundEvents: readonly NotificationMonitorInboundEvent[];
  readonly auditEvents: readonly NotificationMonitorAuditEvent[];
}): JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-body">Monitor</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-3">
        <MiniList title="Deliveries" items={deliveries.map((d) => `${d.channel} · ${d.status}`)} />
        <MiniList title="Inbound" items={inboundEvents.map((e) => `${e.channel} · ${e.kind}`)} />
        <MiniList title="Audit" items={auditEvents.map((event) => event.type)} />
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  children,
}: {
  readonly label: string;
  readonly children: JSX.Element;
}): JSX.Element {
  return (
    <label className="text-on-surface flex flex-col gap-1.5 text-sm font-medium">
      {label}
      {children}
    </label>
  );
}

function FieldValue({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-on-surface-variant">{label}</span>
      <span className="text-on-surface font-medium">{value}</span>
    </div>
  );
}

function PreviewPane({
  label,
  title,
  body,
}: {
  readonly label: string;
  readonly title?: string;
  readonly body?: string;
}): JSX.Element {
  return (
    <div className="border-outline-variant bg-surface-container-low rounded-md border p-3">
      <p className="text-on-surface-variant text-xs font-medium">{label}</p>
      {title ? <p className="text-on-surface mt-1 text-sm font-medium">{title}</p> : null}
      <p className="text-on-surface-variant mt-1 line-clamp-3 text-sm">{body ?? 'Not requested'}</p>
    </div>
  );
}

function MiniList({
  title,
  items,
}: {
  readonly title: string;
  readonly items: readonly string[];
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {items.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li key={item} className="text-on-surface-variant text-sm">
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-on-surface-variant text-sm">None yet</p>
      )}
    </div>
  );
}

/** Render a suppression reason in staff-facing plain language. */
export function formatReason(reason: string): string {
  return reason.replaceAll('_', ' ');
}
