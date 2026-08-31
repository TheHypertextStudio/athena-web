'use client';

import { EmptyState } from '@docket/ui/components';
import { Layers } from '@docket/ui/icons';
import { Badge, Skeleton, Stack, Surface, Text } from '@docket/ui/primitives';
import { type JSX } from 'react';

import { AsyncContent, QueryErrorBanner } from '@/components/admin-feedback';
import { AdminPage, AdminPageHeader } from '@/components/admin-page';
import { AdminList, AdminListRow } from '@/components/admin-table';
import { api } from '@/lib/api';
import { formatTimestamp, lifecycleLabel } from '@/lib/lifecycle';
import { apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';
import type { AdminLifecycleBoard } from '@/lib/types';

/** One column of the retention board. */
type BoardColumn = AdminLifecycleBoard['columns'][number];

/** One organization on the board. */
type BoardOrg = BoardColumn['orgs'][number];

/** The legacy retention board. */
const boardDef = apiQueryOptions(
  queryKeys.lifecycle(),
  () => api.admin.lifecycle.$get(),
  'Could not load the lifecycle board.',
);

/**
 * The legacy organization-retention board.
 *
 * @remarks
 * A compatibility screen for migration diagnostics. Billing never changes these markers, and
 * cancelling a subscription never advances one or deletes workspace data — the Billing section
 * reports subscription access and recovery separately.
 *
 * The board was previously unreachable: it renders a full column per lifecycle state and nothing in
 * the console linked to it. It now sits under Operations in the sidebar.
 */
export default function LifecyclePage(): JSX.Element {
  const query = useApiQuery(boardDef);
  const columns = query.data?.columns ?? [];

  return (
    <AdminPage width="console">
      <AdminPageHeader
        title="Legacy retention markers"
        description="Migration diagnostics for old retention records. Billing cancellation never changes these markers or deletes workspace data."
      />
      <QueryErrorBanner
        error={query.error}
        fallback="Could not load the lifecycle board."
        onRetry={() => void query.refetch()}
      />
      <AsyncContent
        loading={query.isPending}
        empty={columns.length === 0}
        skeleton={<BoardSkeleton />}
        emptyState={
          <EmptyState
            icon={Layers}
            title="No retention records"
            body="No organization carries a legacy retention marker."
          />
        }
      >
        <div className="flex gap-4 overflow-x-auto pb-4">
          {columns.map((column) => (
            <BoardColumnPanel key={column.lifecycleState} column={column} />
          ))}
        </div>
      </AsyncContent>
    </AdminPage>
  );
}

/** One lifecycle state's column of organizations. */
function BoardColumnPanel({ column }: { readonly column: BoardColumn }): JSX.Element {
  const label = lifecycleLabel(column.lifecycleState);

  return (
    <Surface
      as="section"
      tone="canvas"
      shape="medium"
      pad="comfortable"
      className="w-72 shrink-0"
      aria-label={label}
    >
      <Stack gap={3}>
        <div className="flex items-center justify-between gap-2">
          <Text as="h2" token="label-large">
            {label}
          </Text>
          <Badge variant="secondary">{column.orgs.length}</Badge>
        </div>

        <ColumnOrgs label={label} orgs={column.orgs} />
      </Stack>
    </Surface>
  );
}

/** The organizations in one column, or a note that the state is unoccupied. */
function ColumnOrgs({
  label,
  orgs,
}: {
  readonly label: string;
  readonly orgs: readonly BoardOrg[];
}): JSX.Element {
  if (orgs.length === 0) {
    return (
      <EmptyState icon={Layers} title="Empty" body={`No organization is ${label.toLowerCase()}.`} />
    );
  }

  return (
    <AdminList label={`${label} organizations`}>
      {orgs.map((org) => (
        <AdminListRow
          key={org.id}
          href={`/orgs/${org.id}`}
          title={org.name}
          subtitle={retentionNote(org)}
        />
      ))}
    </AdminList>
  );
}

/**
 * The most operationally relevant fact about an organization on the board.
 *
 * @remarks
 * A deletion deadline outranks an export-ready date, which outranks the slug: an operator scanning
 * this board is looking for what is about to happen, and the slug is only worth showing when
 * nothing is.
 *
 * @param org - The organization's board row.
 * @returns the line shown under the organization's name.
 */
function retentionNote(org: BoardOrg): string {
  if (org.deleteAfterAt) return `Delete after ${formatTimestamp(org.deleteAfterAt)}`;
  if (org.exportReadyAt) return `Export ready ${formatTimestamp(org.exportReadyAt)}`;
  return org.slug;
}

/** A loading placeholder for the lifecycle board. */
function BoardSkeleton(): JSX.Element {
  return (
    <div className="flex gap-4 overflow-hidden" aria-hidden="true">
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton key={index} className="h-64 w-72 shrink-0 rounded-xl" />
      ))}
    </div>
  );
}
