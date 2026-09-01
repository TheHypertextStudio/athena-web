'use client';

import { ActorAvatar, EmptyState, RelativeTime } from '@docket/ui/components';
import { relativeTime } from '@docket/ui';
import { Activity } from '@docket/ui/icons';
import { Input, Stack, Text } from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

import {
  AsyncContent,
  ListSkeleton,
  QueryErrorBanner,
  RefreshingOverlay,
} from '@/components/admin-feedback';
import { AdminDisclosureRow } from '@/components/admin-disclosure-row';
import { Property, PropertyList } from '@/components/admin-detail';
import { AdminPage, AdminPageHeader } from '@/components/admin-page';
import { AdminPagination } from '@/components/admin-pagination';
import { api } from '@/lib/api';
import { auditMetadataEntries, auditSubjectLabel, auditTypeLabel } from '@/lib/audit-format';
import { apiQueryOptions, queryKeys, useApiListQuery } from '@/lib/query';
import type { AdminAuditEvent } from '@/lib/types';
import { useDebounced } from '@/lib/use-debounced';
import { usePagedOffset } from '@/lib/use-paged-offset';

/** Page size for the audit feed. */
const PAGE_SIZE = 50;

/** One page of audit events, optionally narrowed to a single event type. */
function auditDef(type: string, offset: number) {
  return apiQueryOptions(
    [...queryKeys.audit(), { type, offset }],
    () =>
      api.admin.audit.$get({
        query: {
          ...(type ? { type } : {}),
          limit: String(PAGE_SIZE),
          offset: String(offset),
        },
      }),
    'Could not load the audit log.',
  );
}

/** What an empty audit feed means, which depends on whether a type filter narrowed it. */
function NoEvents({ filtered }: { readonly filtered: boolean }): JSX.Element {
  if (filtered) {
    return <EmptyState icon={Activity} title="No matching events" />;
  }
  return <EmptyState icon={Activity} title="No operator actions yet" />;
}

/**
 * The operator audit trail.
 *
 * @remarks
 * Every operator mutation across the console — holds, billing actions, lifecycle overrides,
 * impersonation — writes an event here, which makes this the console's forensic surface. It used
 * to render each event's metadata as `JSON.stringify` truncated into one line, with no way to
 * filter and no way to reach anything past the newest page.
 *
 * Each event now reads as a line: who acted, what they did, what they did it to, and when. The
 * metadata expands into labelled fields underneath. The type filter and the pager are both real
 * server-side narrowing — `GET /admin/audit` has always accepted `type` and `offset`.
 */
export default function AuditPage(): JSX.Element {
  const [typeFilter, setTypeFilter] = useState('');
  const debouncedType = useDebounced(typeFilter, 250);
  const [offset, setOffset] = usePagedOffset(debouncedType);
  const query = useApiListQuery(auditDef(debouncedType, offset));

  const events = query.data?.items ?? [];

  return (
    <AdminPage width="list">
      <AdminPageHeader
        title="Audit log"
        actions={
          <Input
            type="search"
            value={typeFilter}
            onChange={(event) => {
              setTypeFilter(event.target.value);
            }}
            placeholder="Filter by event type"
            className="w-64"
            aria-label="Filter by event type"
          />
        }
      />

      {query.error ? (
        <QueryErrorBanner
          error={query.error}
          fallback="Could not load the audit log."
          onRetry={() => void query.refetch()}
        />
      ) : null}

      <AsyncContent
        loading={query.isPending}
        empty={events.length === 0}
        skeleton={<ListSkeleton rows={8} />}
        emptyState={<NoEvents filtered={debouncedType !== ''} />}
      >
        <RefreshingOverlay refreshing={query.isFetching}>
          <Stack gap={1} as="ul">
            {events.map((event) => (
              <AuditRow key={event.id} event={event} />
            ))}
          </Stack>
        </RefreshingOverlay>
      </AsyncContent>

      {/* A sibling of the content, not a child: a page that comes back empty swaps in the empty
          state, and a pager nested inside it would take the only way back with it. */}
      <AdminPagination
        offset={offset}
        pageSize={PAGE_SIZE}
        pageCount={events.length}
        onOffsetChange={setOffset}
        noun="events"
      />
    </AdminPage>
  );
}

/** One audit event: the headline line, with its metadata behind a disclosure. */
function AuditRow({ event }: { readonly event: AdminAuditEvent }): JSX.Element {
  const entries = auditMetadataEntries(event.metadata);
  const actor = event.staffUserId ?? 'System';

  return (
    <AdminDisclosureRow
      name={auditTypeLabel(event.type)}
      leading={<ActorAvatar kind={event.staffUserId ? 'human' : 'agent'} name={actor} size={20} />}
      title={auditTypeLabel(event.type)}
      subtitle={`${auditSubjectLabel(event.subjectType)} · ${event.subjectId}`}
      meta={
        <Text as="span" token="body-small" tone="muted">
          <RelativeTime iso={event.createdAt}>{relativeTime(event.createdAt)}</RelativeTime>
        </Text>
      }
    >
      {entries.length > 0 ? (
        <PropertyList>
          {entries.map((entry) => (
            <Property key={entry.label} label={entry.label} value={entry.value} identifier />
          ))}
        </PropertyList>
      ) : null}
    </AdminDisclosureRow>
  );
}
