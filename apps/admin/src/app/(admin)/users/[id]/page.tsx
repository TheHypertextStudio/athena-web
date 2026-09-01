'use client';

import { EmptyState, IdentityGlyph } from '@docket/ui/components';
import { Building } from '@docket/ui/icons';
import { Button, ControlGroup, Input, Stack, Text } from '@docket/ui/primitives';
import { useParams } from 'next/navigation';
import { type JSX, useState } from 'react';

import { AsyncContent, QueryErrorBanner } from '@/components/admin-feedback';
import { DetailBackLink, DetailSkeleton, Property, PropertyList } from '@/components/admin-detail';
import { AdminPage, AdminPageHeader, AdminSection } from '@/components/admin-page';
import { AdminList, AdminListRow } from '@/components/admin-table';
import { useImpersonation } from '@/components/impersonation';
import { LifecycleBadge } from '@/components/lifecycle-badge';
import { api } from '@/lib/api';
import { formatTimestamp } from '@/lib/lifecycle';
import { apiQueryOptions, queryKeys, useApiMutation, useApiQuery } from '@/lib/query';
import type { AdminMembership, AdminUserDetail } from '@/lib/types';

/** Default impersonation session lifetime, in minutes (the API caps this at 480). */
const IMPERSONATION_TTL_MINUTES = 60;

/** One user with their cross-org memberships. */
function userDef(id: string) {
  return apiQueryOptions(
    queryKeys.user(id),
    () => api.admin.users[':id'].$get({ param: { id } }),
    'Could not load this user.',
  );
}

/**
 * The user detail screen: a user, their org memberships, and the "View as" action.
 *
 * @remarks
 * The "View as" control starts a time-boxed impersonation via `POST /admin/impersonations`
 * (requiring a free-text reason, which is recorded in the audit log) and registers it with the
 * {@link useImpersonation} context so the persistent banner appears across the console.
 */
export default function UserDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const query = useApiQuery(userDef(params.id));
  const detail = query.data;

  return (
    <AdminPage width="form" outline>
      <DetailBackLink href="/users" label="users" />

      {query.error ? (
        <QueryErrorBanner
          error={query.error}
          fallback="Could not load this user."
          onRetry={() => void query.refetch()}
        />
      ) : null}

      <AsyncContent
        loading={query.isPending}
        empty={detail === undefined}
        skeleton={<DetailSkeleton />}
        emptyState={<></>}
      >
        {detail ? <UserDetail detail={detail} /> : null}
      </AsyncContent>
    </AdminPage>
  );
}

/** Everything the screen shows once the user has loaded. */
function UserDetail({ detail }: { readonly detail: AdminUserDetail }): JSX.Element {
  return (
    <Stack gap={6}>
      <AdminPageHeader
        title={detail.user.name || detail.user.email}
        description={detail.user.email}
      />

      <AdminSection title="Account">
        <PropertyList>
          <Property label="User ID" value={detail.user.id} identifier />
          <Property label="Email verified" value={detail.user.emailVerified ? 'Yes' : 'No'} />
          <Property label="Joined" value={formatTimestamp(detail.user.createdAt)} />
        </PropertyList>
      </AdminSection>

      <ViewAsUser userId={detail.user.id} label={detail.user.name || detail.user.email} />

      <AdminSection title="Organization memberships" body="rows">
        <Memberships memberships={detail.memberships} />
      </AdminSection>
    </Stack>
  );
}

/** The impersonation control: a required reason and the action that starts the session. */
function ViewAsUser({
  userId,
  label,
}: {
  readonly userId: string;
  readonly label: string;
}): JSX.Element {
  const { start } = useImpersonation();
  const [reason, setReason] = useState('');

  const impersonate = useApiMutation(
    (variables: { reason: string }) =>
      api.admin.impersonations.$post({
        json: {
          targetUserId: userId,
          reason: variables.reason,
          ttlMinutes: IMPERSONATION_TTL_MINUTES,
        },
      }),
    'Could not start impersonation.',
    {
      onSuccess: (session) => {
        start({
          id: session.id,
          targetUserId: session.targetUserId,
          targetLabel: label,
          expiresAt: session.expiresAt,
        });
        setReason('');
      },
    },
  );

  return (
    <AdminSection
      title="View as user"
      description="Time-boxed. The reason is recorded in the audit log."
    >
      {impersonate.error ? (
        <QueryErrorBanner error={impersonate.error} fallback="Could not start impersonation." />
      ) : null}
      <form
        className="flex flex-col gap-2 @lg:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          impersonate.mutate({ reason });
        }}
      >
        <Input
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
          }}
          placeholder="Reason for impersonation"
          required
          aria-label="Reason for impersonation"
          className="flex-1"
        />
        <ControlGroup>
          <Button type="submit" disabled={impersonate.isPending || reason.trim().length === 0}>
            {impersonate.isPending ? 'Starting…' : 'View as'}
          </Button>
        </ControlGroup>
      </form>
    </AdminSection>
  );
}

/** The organizations this user belongs to, or a note that they belong to none. */
function Memberships({
  memberships,
}: {
  readonly memberships: readonly AdminMembership[];
}): JSX.Element {
  if (memberships.length === 0) {
    return <EmptyState icon={Building} title="No memberships" frame="none" />;
  }

  return (
    <AdminList label="Organization memberships">
      {memberships.map((membership) => (
        <AdminListRow
          key={membership.actorId}
          href={`/orgs/${membership.organizationId}`}
          leading={
            <IdentityGlyph size={20}>
              <Building className="size-3" />
            </IdentityGlyph>
          }
          title={membership.organizationName}
          subtitle={
            <Text as="span" token="body-small" tone="muted" className="font-mono">
              {membership.organizationSlug}
            </Text>
          }
          trailing={<LifecycleBadge state={membership.lifecycleState} />}
        />
      ))}
    </AdminList>
  );
}
