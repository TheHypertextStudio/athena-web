'use client';

import { EmptyState, InlineBanner } from '@docket/ui/components';
import { Bell, RefreshCw } from '@docket/ui/icons';
import { Badge, Button, Stack, Tabs, Text } from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

import { QueryErrorBanner } from '@/components/admin-feedback';
import { AdminPage, AdminPageHeader, AdminSection } from '@/components/admin-page';
import { AdminList, AdminListRow } from '@/components/admin-table';
import type {
  AdminNotificationEstimate,
  AdminNotificationIntent,
  AdminNotificationPreview,
} from '@/lib/types';
import { ComposeStage } from './compose-stage';
import { MonitorStage } from './monitor-stage';
import type {
  NotificationMonitorAuditEvent,
  NotificationMonitorDelivery,
  NotificationMonitorInboundEvent,
} from './monitor-stage';
import type { NotificationAnnouncementDraft } from './notification-console-model';
import { ReviewStage } from './review-stage';
import { SendStage } from './send-stage';

export type {
  NotificationMonitorAuditEvent,
  NotificationMonitorDelivery,
  NotificationMonitorInboundEvent,
} from './monitor-stage';

/** The stages an announcement moves through, in order. */
const STAGES = [
  { value: 'compose', label: 'Compose' },
  { value: 'review', label: 'Review' },
  { value: 'send', label: 'Send' },
  { value: 'monitor', label: 'Monitor' },
] as const;

/** One stage of the announcement workflow. */
type Stage = (typeof STAGES)[number]['value'];

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

/**
 * The staff service-announcement console.
 *
 * @remarks
 * Composing, estimating, previewing, sending, and monitoring an announcement is a sequence: you
 * cannot preview what you have not composed, and you should not send what you have not previewed.
 * The console used to render all five as a flat mosaic of six equally-weighted cards with a fixed
 * minimum height, which stated none of that order — an operator had to already know the workflow to
 * use the screen.
 *
 * The work is now staged, with the announcement list beside it. Stages past Compose need a selected
 * announcement, so they stay unavailable until one exists rather than presenting empty panels.
 *
 * Intentionally presentational: the routed page owns the API calls and state, which keeps this
 * whole workflow testable without browser globals.
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
  const [stage, setStage] = useState<Stage>('compose');

  return (
    <AdminPage width="console">
      <AdminPageHeader
        title="Service announcements"
        description="Compose, review, send, and monitor operational notifications."
        actions={
          <Button variant="outline" disabled={pendingAction !== null} onClick={onRefreshReview}>
            <RefreshCw aria-hidden="true" className="size-4" />
            Refresh
          </Button>
        }
      />

      <QueryErrorBanner error={error} fallback="Could not complete that action." />
      {statusMessage ? (
        <InlineBanner tone="info" title="Done">
          {statusMessage}
        </InlineBanner>
      ) : null}

      <div className="grid gap-6 @4xl:grid-cols-[20rem_minmax(0,1fr)]">
        <AdminSection title={`Announcements (${intents.length})`}>
          <IntentList
            intents={intents}
            selectedId={selectedIntent?.id ?? null}
            onSelect={onSelectIntent}
          />
        </AdminSection>

        <Stack gap={4}>
          <Tabs
            label="Announcement workflow"
            value={stage}
            onValueChange={(next) => {
              setStage(next as Stage);
            }}
            items={STAGES.map((entry) => ({
              value: entry.value,
              label: entry.label,
              disabled: entry.value !== 'compose' && !selectedIntent,
            }))}
          />

          <StagePanel
            stage={stage}
            selectedIntent={selectedIntent}
            estimate={estimate}
            preview={preview}
            deliveries={deliveries}
            inboundEvents={inboundEvents}
            auditEvents={auditEvents}
            draft={draft}
            pendingAction={pendingAction}
            onDraftChange={onDraftChange}
            onCreateDraft={onCreateDraft}
            onTestSend={onTestSend}
            onApprove={onApprove}
            onSendNow={onSendNow}
            onCancel={onCancel}
          />
        </Stack>
      </div>
    </AdminPage>
  );
}

/** Whichever stage is selected, or a prompt to select an announcement first. */
function StagePanel({
  stage,
  selectedIntent,
  estimate,
  preview,
  deliveries,
  inboundEvents,
  auditEvents,
  draft,
  pendingAction,
  onDraftChange,
  onCreateDraft,
  onTestSend,
  onApprove,
  onSendNow,
  onCancel,
}: {
  readonly stage: Stage;
} & Omit<
  NotificationAnnouncementConsoleProps,
  'intents' | 'error' | 'statusMessage' | 'onRefreshReview' | 'onSelectIntent'
>): JSX.Element {
  if (stage === 'compose') {
    return (
      <ComposeStage
        draft={draft}
        pending={pendingAction === 'create'}
        recipientCount={estimate?.recipientCount}
        onDraftChange={onDraftChange}
        onCreateDraft={onCreateDraft}
      />
    );
  }

  if (!selectedIntent) {
    return (
      <EmptyState
        icon={Bell}
        title="No announcement selected"
        body="Compose one, or choose an existing announcement to review it."
      />
    );
  }

  if (stage === 'review') {
    return <ReviewStage estimate={estimate} preview={preview} />;
  }

  if (stage === 'send') {
    return (
      <SendStage
        intent={selectedIntent}
        estimate={estimate}
        pendingAction={pendingAction}
        disabled={pendingAction !== null}
        onTestSend={onTestSend}
        onApprove={onApprove}
        onSendNow={onSendNow}
        onCancel={onCancel}
      />
    );
  }

  return (
    <MonitorStage deliveries={deliveries} inboundEvents={inboundEvents} auditEvents={auditEvents} />
  );
}

/** The announcements that exist, newest first. */
function IntentList({
  intents,
  selectedId,
  onSelect,
}: {
  readonly intents: readonly AdminNotificationIntent[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
}): JSX.Element {
  if (intents.length === 0) {
    return (
      <EmptyState
        icon={Bell}
        title="No announcements yet"
        body="Compose one to tell every affected person what is happening."
      />
    );
  }

  return (
    <AdminList label="Announcements">
      {intents.map((intent) => (
        <AdminListRow
          key={intent.id}
          title={
            <Text as="span" token="body-medium" className="line-clamp-2">
              {intent.subject}
            </Text>
          }
          selected={intent.id === selectedId}
          trailing={<Badge variant="secondary">{intent.status.replaceAll('_', ' ')}</Badge>}
          onActivate={() => {
            onSelect(intent.id);
          }}
        />
      ))}
    </AdminList>
  );
}
