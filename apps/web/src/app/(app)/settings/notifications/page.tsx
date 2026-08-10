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
import type { ContactPointCreate, NotificationPreferencePatch } from '@docket/notifications';
import { Skeleton } from '@docket/ui/primitives';
import { useState, type JSX } from 'react';

import { ContactPointsSection } from '@/components/settings/contact-points-section';
import { NotificationPreferencesSection } from '@/components/settings/notification-preferences-section';
import { SectionHeader } from '@/components/settings/section-header';
import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import {
  apiQueryOptions,
  queryKeys,
  STALE,
  unwrap,
  useApiListQuery,
  useApiMutation,
  useApiQuery,
} from '@/lib/query';

/** The Notifications settings route. */
export default function NotificationsSettingsPage(): JSX.Element {
  const [contactActionId, setContactActionId] = useState<string | null>(null);
  const [verifyActionId, setVerifyActionId] = useState<string | null>(null);

  const preferencesQ = useApiQuery(
    apiQueryOptions(
      queryKeys.notificationPreferences(),
      () => api.v1.me['notification-preferences'].$get(),
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
        () => api.v1.me['notification-preferences'].$patch({ json: patch }),
        'Could not save notification preferences.',
      ),
    invalidateKeys: [queryKeys.notificationPreferences()],
  });
  const addContactPoint = useApiMutation({
    mutationFn: (input: ContactPointCreate) =>
      unwrap(
        () => api.v1.me['contact-points'].$post({ json: input }),
        'Could not add this contact point.',
      ),
    invalidateKeys: [queryKeys.contactPoints()],
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
  });
  const makePrimary = useApiMutation({
    mutationFn: (id: string) =>
      unwrap(
        () => api.v1.me['contact-points'][':id']['make-primary'].$post({ param: { id } }),
        'Could not make this contact point primary.',
      ),
    invalidateKeys: [queryKeys.contactPoints()],
  });
  const disableContactPoint = useApiMutation({
    mutationFn: (id: string) =>
      unwrap(
        () => api.v1.me['contact-points'][':id'].$delete({ param: { id } }),
        'Could not disable this contact point.',
      ),
    invalidateKeys: [queryKeys.contactPoints()],
  });

  const loading = preferencesQ.isPending || contactPointsQ.isPending;
  const loadError = preferencesQ.error
    ? userErrorMessage(preferencesQ.error, 'Could not load notification preferences.')
    : contactPointsQ.error
      ? userErrorMessage(contactPointsQ.error, 'Could not load notification contact points.')
      : null;
  const mutationError = patchPreferences.error
    ? userErrorMessage(patchPreferences.error, 'Could not save notification preferences.')
    : addContactPoint.error
      ? userErrorMessage(addContactPoint.error, 'Could not add that contact point.')
      : verifyContactPoint.error
        ? userErrorMessage(verifyContactPoint.error, 'Could not verify that contact point.')
        : makePrimary.error
          ? userErrorMessage(makePrimary.error, 'Could not make that contact point primary.')
          : disableContactPoint.error
            ? userErrorMessage(disableContactPoint.error, 'Could not disable that contact point.')
            : null;

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="Notifications" description="Decide what Docket tells you, and where." />

      {/* placeholder: the caller's saved notification preferences and their verified contact
          points — which channels exist, which are on, and which addresses they point at. The
          section heading and description above render from static copy. */}
      {loading ? (
        <div className="flex flex-col gap-3" aria-label="Loading notification settings">
          <Skeleton className="h-36 w-full rounded-lg" />
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      ) : loadError || !preferencesQ.data || !contactPointsQ.data ? (
        <p role="alert" className="text-error text-body-medium">
          {loadError ?? 'Could not load notification settings.'}
        </p>
      ) : (
        <>
          <NotificationPreferencesSection
            preferences={preferencesQ.data}
            saving={patchPreferences.isPending}
            error={mutationError}
            onPatch={async (patch) => {
              await patchPreferences.mutateAsync(patch);
            }}
          />
          <ContactPointsSection
            contactPoints={contactPointsQ.data.items}
            creating={addContactPoint.isPending}
            savingId={contactActionId}
            verifyingId={verifyActionId}
            error={mutationError}
            onAdd={async (input) => {
              await addContactPoint.mutateAsync(input);
            }}
            onVerify={async (id, code) => {
              setVerifyActionId(id);
              try {
                await verifyContactPoint.mutateAsync({ id, code });
              } finally {
                setVerifyActionId(null);
              }
            }}
            onMakePrimary={async (id) => {
              setContactActionId(id);
              try {
                await makePrimary.mutateAsync(id);
              } finally {
                setContactActionId(null);
              }
            }}
            onDisable={async (id) => {
              setContactActionId(id);
              try {
                await disableContactPoint.mutateAsync(id);
              } finally {
                setContactActionId(null);
              }
            }}
          />
        </>
      )}
    </div>
  );
}
