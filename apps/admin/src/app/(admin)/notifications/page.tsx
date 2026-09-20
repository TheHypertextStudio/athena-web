'use client';

import { type JSX, useCallback, useEffect, useState } from 'react';

import {
  NotificationAnnouncementConsole,
  type NotificationMonitorAuditEvent,
  type NotificationMonitorDelivery,
  type NotificationMonitorInboundEvent,
} from './notification-console';
import {
  notificationDraftToCreateInput,
  type NotificationAnnouncementDraft,
} from './notification-console-model';
import { api, productApi } from '@/lib/api';
import { readProblemError, toUserFacingError, type UserFacingError } from '@/lib/problem';
import type {
  AdminNotificationEstimate,
  AdminNotificationIntent,
  AdminNotificationPreview,
} from '@/lib/types';

const emptyDraft: NotificationAnnouncementDraft = {
  subject: '',
  bodyText: '',
  audienceType: 'user',
  audienceValue: '',
  channels: ['web', 'email'],
  priority: 'normal',
  replyPolicy: 'none',
  scheduledAt: '',
};

/** Load a notification intent and all its related data. */
async function loadIntent(id: string): Promise<{
  intent: AdminNotificationIntent;
  estimate: AdminNotificationEstimate;
  preview: AdminNotificationPreview;
  deliveries: readonly NotificationMonitorDelivery[];
  inboundEvents: readonly NotificationMonitorInboundEvent[];
  auditEvents: readonly NotificationMonitorAuditEvent[];
}> {
  const [intentRes, estimateRes, previewRes, deliveriesRes, inboundRes, auditRes] =
    await Promise.all([
      api.admin.notifications[':id'].$get({ param: { id } }),
      api.admin.notifications[':id'].estimate.$get({ param: { id } }),
      api.admin.notifications[':id'].preview.$get({ param: { id } }),
      productApi.v1.notifications[':id'].deliveries.$get({ param: { id } }),
      api.admin.notifications[':id']['inbound-events'].$get({ param: { id } }),
      api.admin.notifications[':id'].audit.$get({ param: { id } }),
    ]);

  if (!intentRes.ok) throw await readProblemError(intentRes, 'Could not load intent.');
  if (!estimateRes.ok) throw await readProblemError(estimateRes, 'Could not estimate audience.');
  if (!previewRes.ok) throw await readProblemError(previewRes, 'Could not render preview.');

  const intent = await intentRes.json();
  const estimate = await estimateRes.json();
  const preview = await previewRes.json();
  const deliveries = deliveriesRes.ok
    ? (await deliveriesRes.json()).items.map((delivery) => ({
        id: delivery.id,
        channel: delivery.channel,
        status: delivery.status,
      }))
    : [];
  const inboundEvents = inboundRes.ok
    ? (await inboundRes.json()).items.map((event) => ({
        id: event.id,
        channel: event.channel,
        kind: event.kind,
      }))
    : [];
  const auditEvents = auditRes.ok
    ? (await auditRes.json()).items.map((event) => ({
        id: event.id,
        type: event.type,
      }))
    : [];

  return { intent, estimate, preview, deliveries, inboundEvents, auditEvents };
}

/** Hook for managing notification list state and loading. */
function useNotificationList() {
  const [intents, setIntents] = useState<readonly AdminNotificationIntent[]>([]);
  const [selectedIntent, setSelectedIntent] = useState<AdminNotificationIntent | null>(null);
  const [estimate, setEstimate] = useState<AdminNotificationEstimate | null>(null);
  const [preview, setPreview] = useState<AdminNotificationPreview | null>(null);
  const [deliveries, setDeliveries] = useState<readonly NotificationMonitorDelivery[]>([]);
  const [inboundEvents, setInboundEvents] = useState<readonly NotificationMonitorInboundEvent[]>(
    [],
  );
  const [auditEvents, setAuditEvents] = useState<readonly NotificationMonitorAuditEvent[]>([]);

  const loadIntentData = useCallback(async (id: string): Promise<void> => {
    const data = await loadIntent(id);
    setSelectedIntent(data.intent);
    setEstimate(data.estimate);
    setPreview(data.preview);
    setDeliveries(data.deliveries);
    setInboundEvents(data.inboundEvents);
    setAuditEvents(data.auditEvents);
  }, []);

  const loadList = useCallback(
    async (preferredIntentId?: string): Promise<void> => {
      const res = await api.admin.notifications.$get({
        query: { limit: '25', offset: '0' },
      });
      if (!res.ok) throw await readProblemError(res, 'Could not load notifications.');

      const page = await res.json();
      setIntents(page.items);
      const nextId = preferredIntentId ?? page.items[0]?.id;
      if (nextId) {
        await loadIntentData(nextId);
      } else {
        setSelectedIntent(null);
        setEstimate(null);
        setPreview(null);
        setDeliveries([]);
        setInboundEvents([]);
        setAuditEvents([]);
      }
    },
    [loadIntentData],
  );

  return {
    intents,
    selectedIntent,
    estimate,
    preview,
    deliveries,
    inboundEvents,
    auditEvents,
    loadList,
    loadIntentData,
  };
}

/** Hook for managing notification action handlers. */
function useNotificationActions(
  selectedIntent: AdminNotificationIntent | null,
  loadIntentData: (id: string) => Promise<void>,
  onStatusMessage: (msg: string) => void,
  onError: (err: UserFacingError) => void,
) {
  const createDraft = useCallback(async (draft: NotificationAnnouncementDraft) => {
    const res = await productApi.v1.notifications.$post({
      json: notificationDraftToCreateInput(draft),
    });
    if (!res.ok) throw await readProblemError(res, 'Could not create notification draft.');
    const intent = await res.json();
    return intent.id;
  }, []);

  const refreshReview = useCallback(async () => {
    if (!selectedIntent) return;
    await loadIntentData(selectedIntent.id);
  }, [selectedIntent, loadIntentData]);

  const testSend = useCallback(async () => {
    if (!selectedIntent) return;
    const res = await productApi.v1.notifications[':id'].test.$post({
      param: { id: selectedIntent.id },
    });
    if (!res.ok) throw await readProblemError(res, 'Could not send test notification.');
    await loadIntentData(selectedIntent.id);
  }, [selectedIntent, loadIntentData]);

  const approve = useCallback(async () => {
    if (!selectedIntent) return;
    const res = await api.admin.notifications[':id'].decision.$put({
      param: { id: selectedIntent.id },
      json: { decision: 'approved' },
    });
    if (!res.ok) throw await readProblemError(res, 'Could not approve notification.');
    await loadIntentData(selectedIntent.id);
  }, [selectedIntent, loadIntentData]);

  const sendNow = useCallback(async () => {
    if (!selectedIntent) return;
    const res = await productApi.v1.notifications[':id'].send.$post({
      param: { id: selectedIntent.id },
    });
    if (!res.ok) throw await readProblemError(res, 'Could not send notification.');
    await loadIntentData(selectedIntent.id);
  }, [selectedIntent, loadIntentData]);

  const cancel = useCallback(async () => {
    if (!selectedIntent) return;
    const res = await productApi.v1.notifications[':id'].cancel.$post({
      param: { id: selectedIntent.id },
    });
    if (!res.ok) throw await readProblemError(res, 'Could not cancel notification.');
    await loadIntentData(selectedIntent.id);
  }, [selectedIntent, loadIntentData]);

  const runAction = useCallback(
    async (action: string, run: () => Promise<void>): Promise<void> => {
      try {
        await run();
      } catch (caught) {
        onError(toUserFacingError(caught, 'Notification action failed.'));
      }
    },
    [onError],
  );

  return { createDraft, refreshReview, testSend, approve, sendNow, cancel, runAction };
}

/** Wrapper for actions that manage pending state, errors, and status messages. */
function useActionHandler(
  setPendingAction: (action: string | null) => void,
  setError: (err: UserFacingError | null) => void,
) {
  return useCallback(
    async (
      action: string,
      fn: () => Promise<void>,
      onSuccess?: (msg: string) => void,
      errorMsg?: string,
    ): Promise<void> => {
      setPendingAction(action);
      setError(null);
      try {
        await fn();
        if (onSuccess) onSuccess('success');
      } catch (caught) {
        setError(toUserFacingError(caught, errorMsg ?? 'Action failed.'));
      } finally {
        setPendingAction(null);
      }
    },
    [setPendingAction, setError],
  );
}

/**
 * Staff service-announcement console.
 *
 * @remarks
 * A Client Component that composes service announcements through `/v1/notifications` and uses the
 * staff `/admin/notifications/*` safety APIs for estimate, preview, audit, and inbound monitoring.
 */
export default function NotificationsPage(): JSX.Element {
  const [draft, setDraft] = useState<NotificationAnnouncementDraft>(emptyDraft);
  const [pendingAction, setPendingAction] = useState<string | null>('load');
  const [error, setError] = useState<UserFacingError | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const notificationList = useNotificationList();
  const actions = useNotificationActions(
    notificationList.selectedIntent,
    notificationList.loadIntentData,
    setStatusMessage,
    setError,
  );

  const runWithState = useActionHandler(setPendingAction, setError);

  useEffect(() => {
    void runWithState('load', () => notificationList.loadList(), undefined, 'Could not load.');
  }, [notificationList, runWithState]);

  return (
    <NotificationAnnouncementConsole
      intents={notificationList.intents}
      selectedIntent={notificationList.selectedIntent}
      estimate={notificationList.estimate}
      preview={notificationList.preview}
      deliveries={notificationList.deliveries}
      inboundEvents={notificationList.inboundEvents}
      auditEvents={notificationList.auditEvents}
      draft={draft}
      pendingAction={pendingAction}
      error={error}
      statusMessage={statusMessage}
      onDraftChange={(k, v) => {
        setDraft((curr) => ({ ...curr, [k]: v }));
      }}
      onCreateDraft={() => {
        void runWithState('create', async () => {
          const intentId = await actions.createDraft(draft);
          setDraft(emptyDraft);
          await notificationList.loadList(intentId);
          setStatusMessage('Draft created');
        });
      }}
      onRefreshReview={() => {
        void runWithState('refresh', async () => {
          await actions.refreshReview();
          setStatusMessage('Preview refreshed');
        });
      }}
      onTestSend={() => {
        void runWithState('test', async () => {
          await actions.testSend();
          setStatusMessage('Test send queued');
        });
      }}
      onApprove={() => {
        void runWithState('approve', async () => {
          await actions.approve();
          setStatusMessage('Notification approved');
        });
      }}
      onSendNow={() => {
        void runWithState('send', async () => {
          await actions.sendNow();
          setStatusMessage('Notification sent');
        });
      }}
      onCancel={() => {
        void runWithState('cancel', async () => {
          await actions.cancel();
          setStatusMessage('Notification canceled');
        });
      }}
      onSelectIntent={(id) => {
        void runWithState('load', async () => {
          await notificationList.loadIntentData(id);
          setStatusMessage(null);
        });
      }}
    />
  );
}
