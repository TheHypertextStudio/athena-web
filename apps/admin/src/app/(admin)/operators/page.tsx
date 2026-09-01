'use client';

import { IdentityGlyph } from '@docket/ui/components';
import { Shield } from '@docket/ui/icons';
import { Badge, Text } from '@docket/ui/primitives';
import { type JSX } from 'react';

import { AsyncContent, ListSkeleton, QueryErrorBanner } from '@/components/admin-feedback';
import { AdminPage, AdminPageHeader, AdminSection } from '@/components/admin-page';
import { AdminList, AdminListRow } from '@/components/admin-table';
import { api } from '@/lib/api';
import { formatTimestamp } from '@/lib/lifecycle';
import { STALE, apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';
import type { AdminStaff } from '@/lib/types';

/** Page size for the operator roster. Staff counts are small; one page is the whole list. */
const PAGE_SIZE = 100;

/** The operator roster. */
const operatorsDef = apiQueryOptions(
  queryKeys.staff(),
  () => api.admin.staff.$get({ query: { limit: String(PAGE_SIZE), offset: '0' } }),
  'Could not load operators.',
  { staleTime: STALE.standard },
);

/**
 * The operator roster: who holds staff access, at what tier, and what provisions it.
 *
 * @remarks
 * The column that matters is provenance. A `manual` grant is made here and is never touched by the
 * Google Workspace group sync; a `google_group` grant mirrors group membership, so its tier follows
 * the group and revoking it here is undone within minutes. Docket's documented recovery story
 * depends on at least one `manual` superadmin existing — that is the account that still works when
 * the Workspace configuration is itself what broke — and this screen exists so that can be
 * confirmed at a glance rather than by calling the API.
 *
 * @returns the roster screen.
 */
export default function OperatorsPage(): JSX.Element {
  const operators = useApiQuery(operatorsDef);
  const items = operators.data?.items ?? [];

  return (
    <AdminPage width="list">
      <AdminPageHeader title="Operators" />

      {operators.error ? (
        <QueryErrorBanner
          error={operators.error}
          fallback="Could not load operators."
          onRetry={() => void operators.refetch()}
        />
      ) : null}

      <BreakGlassWarning operators={items} loaded={!operators.isPending && !operators.error} />

      <AdminSection title="Staff access" body="rows">
        <AsyncContent
          loading={operators.isPending}
          empty={items.length === 0}
          skeleton={<ListSkeleton rows={4} />}
          emptyState={
            <Text as="p" token="body-small" tone="muted">
              No operators yet.
            </Text>
          }
        >
          <AdminList label="Operators">
            {items.map((operator) => (
              <AdminListRow
                key={operator.id}
                interactive={false}
                leading={
                  <IdentityGlyph size={20}>
                    <Shield className="size-3" />
                  </IdentityGlyph>
                }
                title={operator.userName || operator.userEmail}
                subtitle={operator.userEmail}
                meta={formatTimestamp(operator.createdAt)}
                trailing={
                  <>
                    <Badge variant="secondary">{operator.role}</Badge>
                    <ProvenanceBadge operator={operator} />
                  </>
                }
              />
            ))}
          </AdminList>
        </AsyncContent>
      </AdminSection>
    </AdminPage>
  );
}

/**
 * Warn when no manually granted superadmin is left.
 *
 * @remarks
 * Rendered only once the roster has actually loaded. Showing it while the read is outstanding would
 * announce that the deployment has locked itself out on every page open.
 *
 * @param props - The loaded roster, and whether it is loaded.
 * @returns the warning, or nothing.
 */
function BreakGlassWarning({
  operators,
  loaded,
}: {
  readonly operators: readonly AdminStaff[];
  readonly loaded: boolean;
}): JSX.Element | null {
  const manualSuperadmins = operators.filter(
    (operator) => operator.managedBy === 'manual' && operator.role === 'superadmin',
  ).length;
  if (!loaded || manualSuperadmins > 0) return null;

  return (
    <AdminSection title="No way back in">
      <Text as="p" token="body-medium" tone="muted" role="status">
        Every superadmin here is provisioned from a Google Workspace group, so a broken Workspace
        configuration would leave nobody able to restore access. Grant one operator superadmin from
        this console to keep a way back in.
      </Text>
    </AdminSection>
  );
}

/** How a grant is provisioned, and — for a synced one — when it was last reconciled. */
function ProvenanceBadge({ operator }: { readonly operator: AdminStaff }): JSX.Element {
  if (operator.managedBy === 'manual') {
    return <Badge variant="outline">Granted here</Badge>;
  }
  const synced = operator.groupsSyncedAt;
  return (
    <Badge
      variant="default"
      title={
        synced
          ? `Google Workspace group membership, last reconciled ${formatTimestamp(synced)}`
          : 'Google Workspace group membership, not yet reconciled'
      }
    >
      Workspace group
    </Badge>
  );
}
