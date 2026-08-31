'use client';

import { ActorAvatar, EmptyState, RelativeTime } from '@docket/ui/components';
import { relativeTime } from '@docket/ui';
import { Activity, ChevronDown, ChevronRight } from '@docket/ui/icons';
import { Button, Input, Stack, Surface, Text } from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

import {
  AsyncContent,
  ListSkeleton,
  QueryErrorBanner,
  RefreshingOverlay,
} from '@/components/admin-feedback';
import { AdminPage, AdminPageHeader } from '@/components/admin-page';
import { AdminPagination } from '@/components/admin-pagination';
import { api } from '@/lib/api';
import { auditMetadataEntries, auditSubjectLabel, auditTypeLabel } from '@/lib/audit-format';
import { apiQueryOptions, queryKeys, useApiListQuery } from '@/lib/query';
import type { AdminAuditEvent } from '@/lib/types';
import { useDebounced } from '@/lib/use-debounced';

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
    return (
      <EmptyState
        icon={Activity}
        title="No matching events"
        body="No operator action of that type has been recorded."
      />
    );
  }
  return (
    <EmptyState
      icon={Activity}
      title="No operator actions yet"
      body="Holds, billing decisions, and impersonations are recorded here as they happen."
    />
  );
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
  const [offset, setOffset] = useState(0);
  const debouncedType = useDebounced(typeFilter, 250);
  const query = useApiListQuery(auditDef(debouncedType, offset));

  const events = query.data?.items ?? [];

  return (
    <AdminPage width="list">
      <AdminPageHeader
        title="Audit log"
        description="Every operator action, newest first."
        actions={
          <Input
            type="search"
            value={typeFilter}
            onChange={(event) => {
              setTypeFilter(event.target.value);
              setOffset(0);
            }}
            placeholder="Filter by event type"
            className="w-64"
            aria-label="Filter by event type"
          />
        }
      />

      <QueryErrorBanner
        error={query.error}
        fallback="Could not load the audit log."
        onRetry={() => void query.refetch()}
      />

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
  const [expanded, setExpanded] = useState(false);
  const entries = auditMetadataEntries(event.metadata);
  const actor = event.staffUserId ?? 'System';
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <Surface as="li" tone="card" shape="small" pad="none">
      <div className="flex items-center gap-3 px-3 py-2">
        <ActorAvatar kind={event.staffUserId ? 'human' : 'agent'} name={actor} size={20} />

        <div className="flex min-w-0 flex-1 flex-col">
          <Text as="span" token="body-medium" truncate>
            {auditTypeLabel(event.type)}
          </Text>
          <Text as="span" token="body-small" tone="muted" truncate>
            {`${auditSubjectLabel(event.subjectType)} · ${event.subjectId}`}
          </Text>
        </div>

        <Text as="span" token="body-small" tone="muted" className="shrink-0">
          <RelativeTime iso={event.createdAt}>{relativeTime(event.createdAt)}</RelativeTime>
        </Text>

        {entries.length > 0 ? (
          <Button
            variant="ghost"
            controlSize="sm"
            iconOnly
            aria-expanded={expanded}
            aria-label={expanded ? 'Hide event detail' : 'Show event detail'}
            onClick={() => {
              setExpanded((open) => !open);
            }}
          >
            <Chevron aria-hidden="true" className="size-4" />
          </Button>
        ) : null}
      </div>

      {expanded ? (
        <dl className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-4 gap-y-1 px-3 pb-3 pl-11">
          {entries.map((entry) => (
            <div key={entry.label} className="contents">
              <Text as="dt" token="body-small" tone="muted">
                {entry.label}
              </Text>
              <Text as="dd" token="body-small" className="font-mono break-all">
                {entry.value}
              </Text>
            </div>
          ))}
        </dl>
      ) : null}
    </Surface>
  );
}
