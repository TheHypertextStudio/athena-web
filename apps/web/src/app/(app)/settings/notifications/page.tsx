'use client';

/**
 * The Notifications settings section.
 *
 * @remarks
 * The single, canonical Notifications page. Notification preferences and contact points are
 * caller-owned (read from `/v1/me/*`), so this never needed a workspace at all — the former
 * `/orgs/[orgId]/settings/notifications` (which this page used to delegate to, purely to reach a
 * workspace id it never actually used) has been removed.
 */
import type {
  ContactPointCreate,
  NotificationPreferencePatch,
} from '@docket/notifications/schemas';
import { Skeleton } from '@docket/ui/primitives';
import { useState, type JSX } from 'react';

import { LoadFailure } from '@/components/feedback';
import { ContactPointsSection } from '@/components/settings/contact-points-section';
import { NotificationPreferencesSection } from '@/components/settings/notification-preferences-section';
import { api } from '@/lib/api';
import {
  apiQueryOptions,
  queryKeys,
  STALE,
  unwrap,
  useApiListQuery,
  useApiMutation,
  useApiQuery,
} from '@/lib/query';
import { SettingsSectionPage } from '@/components/settings/settings-section-page';

/** The Notifications settings route. */
export default function NotificationsSettingsPage(): JSX.Element {
  const [contactActionId, setContactActionId] = useState<string | null>(null);
  const [verifyActionId, setVerifyActionId] = useState<string | null>(null);

  const preferencesQ = useApiQuery(
    apiQueryOptions(
      queryKeys.notificationPreferences(),
      () => api.v1.me.notifications.preferences.$get(),
      'Could not load notification preferences.',
      { staleTime: STALE.standard },
    ),
  );
  const contactPointsQ = useApiListQuery(
    apiQueryOptions(
      queryKeys.contactPoints(),
      () => api.v1.me['contact-points'].$get(),
      'Could not load notification contact points.',
      { staleTime: STALE.standard },
    ),
  );

  const patchPreferences = useApiMutation({
    mutationFn: (patch: NotificationPreferencePatch) =>
      unwrap(
        () => api.v1.me.notifications.preferences.$patch({ json: patch }),
        'Could not save notification preferences.',
      ),
    invalidateKeys: [queryKeys.notificationPreferences()],
    failureTitle: 'Could not save notification preferences.',
  });
  const addContactPoint = useApiMutation({
    mutationFn: (input: ContactPointCreate) =>
      unwrap(
        () => api.v1.me['contact-points'].$post({ json: input }),
        'Could not add this contact point.',
      ),
    invalidateKeys: [queryKeys.contactPoints()],
    failureTitle: 'Could not add this contact point.',
  });
  const verifyContactPoint = useApiMutation({
    mutationFn: (input: { id: string; code: string }) =>
      unwrap(
        () =>
          api.v1.me['contact-points'][':id'].verify.$post({
            param: { id: input.id },
            json: { code: input.code },
          }),
        'Could not verify this contact point.',
      ),
    invalidateKeys: [queryKeys.contactPoints()],
    failureTitle: 'Could not verify this contact point.',
  });
  const makePrimary = useApiMutation({
    mutationFn: (id: string) =>
      unwrap(
        () => api.v1.me['contact-points'][':id']['make-primary'].$post({ param: { id } }),
        'Could not make this contact point primary.',
      ),
    invalidateKeys: [queryKeys.contactPoints()],
    failureTitle: 'Could not make this contact point primary.',
  });
  const disableContactPoint = useApiMutation({
    mutationFn: (id: string) =>
      unwrap(
        () => api.v1.me['contact-points'][':id'].$delete({ param: { id } }),
        'Could not disable this contact point.',
      ),
    invalidateKeys: [queryKeys.contactPoints()],
    failureTitle: 'Could not disable this contact point.',
  });

  const loading = preferencesQ.isPending || contactPointsQ.isPending;
  const loadError = preferencesQ.error ?? contactPointsQ.error;

  return (
    <SettingsSectionPage
      title="Notifications"
      description="Decide what Docket tells you, and where."
    >
      {/* placeholder: the caller's saved notification preferences and their verified contact
          points — which channels exist, which are on, and which addresses they point at. The
          section heading and description above render from static copy. */}
      {loading ? (
        <div className="flex flex-col gap-3" aria-label="Loading notification settings">
          <Skeleton className="h-36 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : loadError || !preferencesQ.data || !contactPointsQ.data ? (
        <LoadFailure
          title="Notification settings"
          error={loadError}
          onRetry={() => {
            void preferencesQ.refetch();
            void contactPointsQ.refetch();
          }}
          retrying={preferencesQ.isFetching || contactPointsQ.isFetching}
        />
      ) : (
        <>
          {/* Contact points first: a channel is only choosable once there is somewhere to
              send it. Asking someone to enable SMS and Push above a form they have not
              reached yet is the page telling them to pick a destination they cannot name. */}
          <ContactPointsSection
            contactPoints={contactPointsQ.data.items}
            creating={addContactPoint.isPending}
            savingId={contactActionId}
            verifyingId={verifyActionId}
            onAdd={(input) => {
              addContactPoint.mutate(input);
            }}
            onVerify={(id, code) => {
              setVerifyActionId(id);
              verifyContactPoint.mutate(
                { id, code },
                {
                  onSettled: () => {
                    setVerifyActionId(null);
                  },
                },
              );
            }}
            onMakePrimary={(id) => {
              setContactActionId(id);
              makePrimary.mutate(id, {
                onSettled: () => {
                  setContactActionId(null);
                },
              });
            }}
            onDisable={(id) => {
              setContactActionId(id);
              disableContactPoint.mutate(id, {
                onSettled: () => {
                  setContactActionId(null);
                },
              });
            }}
          />
          <NotificationPreferencesSection
            preferences={preferencesQ.data}
            saving={patchPreferences.isPending}
            onPatch={(patch) => {
              patchPreferences.mutate(patch);
            }}
          />
        </>
      )}
    </SettingsSectionPage>
  );
}
