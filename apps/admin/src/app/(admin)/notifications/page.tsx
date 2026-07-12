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
import { readProblemError, userErrorMessage } from '@/lib/problem';
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

/**
 * Staff service-announcement console.
 *
 * @remarks
 * A Client Component that composes service announcements through `/v1/notifications` and uses the
 * staff `/admin/notifications/*` safety APIs for estimate, preview, audit, and inbound monitoring.
 */
export default function NotificationsPage(): JSX.Element {
  const [intents, setIntents] = useState<readonly AdminNotificationIntent[]>([]);
  const [selectedIntent, setSelectedIntent] = useState<AdminNotificationIntent | null>(null);
  const [estimate, setEstimate] = useState<AdminNotificationEstimate | null>(null);
  const [preview, setPreview] = useState<AdminNotificationPreview | null>(null);
  const [deliveries, setDeliveries] = useState<readonly NotificationMonitorDelivery[]>([]);
  const [inboundEvents, setInboundEvents] = useState<readonly NotificationMonitorInboundEvent[]>(
    [],
  );
  const [auditEvents, setAuditEvents] = useState<readonly NotificationMonitorAuditEvent[]>([]);
  const [draft, setDraft] = useState<NotificationAnnouncementDraft>(emptyDraft);
  const [pendingAction, setPendingAction] = useState<string | null>('load');
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const loadIntent = useCallback(async (id: string): Promise<void> => {
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
    if (!estimateRes.ok) {
      throw await readProblemError(estimateRes, 'Could not estimate audience.');
    }
    if (!previewRes.ok) throw await readProblemError(previewRes, 'Could not render preview.');

    const intent = await intentRes.json();
    setSelectedIntent(intent);
    setEstimate(await estimateRes.json());
    setPreview(await previewRes.json());
    setDeliveries(
      deliveriesRes.ok
        ? (await deliveriesRes.json()).items.map((delivery) => ({
            id: delivery.id,
            channel: delivery.channel,
            status: delivery.status,
          }))
        : [],
    );
    setInboundEvents(
      inboundRes.ok
        ? (await inboundRes.json()).items.map((event) => ({
            id: event.id,
            channel: event.channel,
            kind: event.kind,
          }))
        : [],
    );
    setAuditEvents(
      auditRes.ok
        ? (await auditRes.json()).items.map((event) => ({
            id: event.id,
            type: event.type,
          }))
        : [],
    );
  }, []);

  const loadList = useCallback(
    async (preferredIntentId?: string): Promise<void> => {
      setPendingAction('load');
      setError(null);
      try {
        const res = await api.admin.notifications.$get({
          query: { limit: '25', offset: '0' },
        });
        if (!res.ok) {
          throw await readProblemError(res, 'Could not load notifications.');
        }
        const page = await res.json();
        setIntents(page.items);
        const nextId = preferredIntentId ?? page.items[0]?.id;
        if (nextId) await loadIntent(nextId);
        if (!nextId) {
          setSelectedIntent(null);
          setEstimate(null);
          setPreview(null);
          setDeliveries([]);
          setInboundEvents([]);
          setAuditEvents([]);
        }
      } catch (caught) {
        setError(userErrorMessage(caught, 'Something went wrong loading notifications.'));
      } finally {
        setPendingAction(null);
      }
    },
    [loadIntent],
  );

  useEffect(() => {
    void loadList();
  }, [loadList]);

  function updateDraft<K extends keyof NotificationAnnouncementDraft>(
    key: K,
    value: NotificationAnnouncementDraft[K],
  ): void {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function createDraft(): Promise<void> {
    await runAction('create', async () => {
      const res = await productApi.v1.notifications.$post({
        json: notificationDraftToCreateInput(draft),
      });
      if (!res.ok) throw await readProblemError(res, 'Could not create notification draft.');
      const intent = await res.json();
      setDraft(emptyDraft);
      await loadList(intent.id);
      setStatusMessage('Draft created');
    });
  }

  async function selectIntent(id: string): Promise<void> {
    await runAction('load', async () => {
      await loadIntent(id);
      setStatusMessage(null);
    });
  }

  async function refreshReview(): Promise<void> {
    if (!selectedIntent) return;
    await runAction('refresh', async () => {
      await loadIntent(selectedIntent.id);
      setStatusMessage('Preview refreshed');
    });
  }

  async function testSend(): Promise<void> {
    if (!selectedIntent) return;
    await runAction('test', async () => {
      const res = await productApi.v1.notifications[':id'].test.$post({
        param: { id: selectedIntent.id },
      });
      if (!res.ok) throw await readProblemError(res, 'Could not send test notification.');
      await loadIntent(selectedIntent.id);
      setStatusMessage('Test send queued');
    });
  }

  async function approve(): Promise<void> {
    if (!selectedIntent) return;
    await runAction('approve', async () => {
      const res = await api.admin.notifications[':id'].approve.$post({
        param: { id: selectedIntent.id },
      });
      if (!res.ok) throw await readProblemError(res, 'Could not approve notification.');
      await loadIntent(selectedIntent.id);
      setStatusMessage('Notification approved');
    });
  }

  async function sendNow(): Promise<void> {
    if (!selectedIntent) return;
    await runAction('send', async () => {
      const res = await productApi.v1.notifications[':id'].send.$post({
        param: { id: selectedIntent.id },
      });
      if (!res.ok) throw await readProblemError(res, 'Could not send notification.');
      await loadIntent(selectedIntent.id);
      setStatusMessage('Notification sent');
    });
  }

  async function cancel(): Promise<void> {
    if (!selectedIntent) return;
    await runAction('cancel', async () => {
      const res = await productApi.v1.notifications[':id'].cancel.$post({
        param: { id: selectedIntent.id },
      });
      if (!res.ok) throw await readProblemError(res, 'Could not cancel notification.');
      await loadIntent(selectedIntent.id);
      setStatusMessage('Notification canceled');
    });
  }

  async function runAction(action: string, run: () => Promise<void>): Promise<void> {
    setPendingAction(action);
    setError(null);
    try {
      await run();
    } catch (caught) {
      setError(userErrorMessage(caught, 'Notification action failed.'));
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <NotificationAnnouncementConsole
      intents={intents}
      selectedIntent={selectedIntent}
      estimate={estimate}
      preview={preview}
      deliveries={deliveries}
      inboundEvents={inboundEvents}
      auditEvents={auditEvents}
      draft={draft}
      pendingAction={pendingAction}
      error={error}
      statusMessage={statusMessage}
      onDraftChange={updateDraft}
      onCreateDraft={() => void createDraft()}
      onRefreshReview={() => void refreshReview()}
      onTestSend={() => void testSend()}
      onApprove={() => void approve()}
      onSendNow={() => void sendNow()}
      onCancel={() => void cancel()}
      onSelectIntent={(id) => void selectIntent(id)}
    />
  );
}
