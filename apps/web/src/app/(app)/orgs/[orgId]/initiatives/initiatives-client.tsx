'use client';

import type { InitiativeAttentionItem, InitiativeOverviewOut } from '@docket/types';
import { EmptyState } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Plus, Target } from '@docket/ui/icons';
import { Badge, Button, Skeleton } from '@docket/ui/primitives';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { type JSX, useCallback, useMemo, useState } from 'react';

import { CreateInitiativeDialog } from '@/components/initiatives/create-initiative';
import { initiativeOverviewDef } from '@/lib/fetch-initiative-overview';
import { queryKeys, useApiQuery, usePrefetchApi } from '@/lib/query';
import { initiativeDetailDef } from '@/lib/fetch-initiative-detail';
import { userErrorMessage } from '@/lib/problem';

const STATUS_LABEL = {
  proposed: 'Proposed',
  active: 'Active',
  completed: 'Completed',
  canceled: 'Canceled',
} as const;
const HEALTH_LABEL = {
  on_track: 'On track',
  at_risk: 'At risk',
  off_track: 'Off track',
} as const;

function AttentionSurface({
  item,
  orgId,
  index,
  count,
  onPrevious,
  onNext,
}: {
  item: InitiativeAttentionItem;
  orgId: string;
  index: number;
  count: number;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const href = `/orgs/${item.organizationId}/initiatives/${item.initiativeId}${item.action === 'update' ? '?tab=updates&compose=1' : ''}`;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      <div className="min-w-0">
        <div className="mb-1 flex items-center gap-2 text-xs">
          <span className="text-on-surface-variant font-medium">Needs your attention</span>
          <Badge variant={item.severity === 'off_track' ? 'destructive' : 'secondary'}>
            {item.severity === 'stale' ? 'Update due' : HEALTH_LABEL[item.severity]}
          </Badge>
          {item.organizationId !== orgId ? (
            <Badge variant="outline">{item.organizationName}</Badge>
          ) : null}
        </div>
        <Link href={href} className="text-on-surface text-sm font-medium hover:underline">
          {item.title}
        </Link>
        {item.excerpt ? (
          <p className="text-on-surface-variant mt-1 line-clamp-2 text-sm">{item.excerpt}</p>
        ) : null}
        {item.organizationId !== orgId && item.parentInitiativeName ? (
          <p className="text-on-surface-variant mt-1 text-xs">In {item.parentInitiativeName}</p>
        ) : null}
      </div>
      <footer data-testid="initiative-attention-footer" className="w-full">
        <div
          data-testid="initiative-attention-controls"
          className="flex items-center justify-between gap-3"
        >
          <Button asChild size="sm" variant="outline" className="min-h-10 @2xl:min-h-0">
            <Link href={href}>{item.action === 'update' ? 'Post update' : 'Open'}</Link>
          </Button>
          {count > 1 ? (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Previous attention item"
                onClick={onPrevious}
              >
                ←
              </Button>
              <span className="text-on-surface-variant min-w-8 text-center text-xs tabular-nums">
                {index + 1}/{count}
              </span>
              <Button variant="ghost" size="icon" aria-label="Next attention item" onClick={onNext}>
                →
              </Button>
            </div>
          ) : null}
        </div>
      </footer>
    </div>
  );
}

/** Executive Initiative hierarchy overview. */
export default function InitiativesListClient(): JSX.Element {
  const { orgId } = useParams<{ orgId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const prefetch = usePrefetchApi();
  const initiativeNoun = useVocabulary('initiative');
  const initiativePlural = useVocabulary('initiative', { plural: true });
  const [createOpen, setCreateOpen] = useState(false);
  const [attentionIndex, setAttentionIndex] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | keyof typeof STATUS_LABEL>('all');
  const [sort, setSort] = useState<'title' | 'target' | 'status'>('title');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const overview = useApiQuery(initiativeOverviewDef(orgId));
  const data: InitiativeOverviewOut | undefined = overview.data;
  const attention = data?.attention ?? [];
  const currentAttention = attention[attentionIndex % Math.max(attention.length, 1)];
  const visibleItems = useMemo(() => {
    const items = data?.items ?? [];
    const byId = new Map(items.map((item) => [item.id, item]));
    const childrenByParent = new Map<string | null, typeof items>();
    for (const item of items) {
      const siblings = childrenByParent.get(item.parentInitiativeId) ?? [];
      childrenByParent.set(item.parentInitiativeId, [...siblings, item]);
    }
    const compare = (a: (typeof items)[number], b: (typeof items)[number]): number => {
      if (sort === 'target') return (a.targetDate ?? '9999').localeCompare(b.targetDate ?? '9999');
      if (sort === 'status')
        return a.status.localeCompare(b.status) || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    };
    const ordered: typeof items = [];
    const visit = (parentId: string | null): void => {
      for (const item of [...(childrenByParent.get(parentId) ?? [])].sort(compare)) {
        ordered.push(item);
        visit(item.id);
      }
    };
    visit(null);
    const needle = search.trim().toLowerCase();
    const keep = new Set<string>();
    for (const item of ordered) {
      const matchesText =
        !needle || `${item.name} ${item.summary ?? ''}`.toLowerCase().includes(needle);
      const matchesStatus = statusFilter === 'all' || item.status === statusFilter;
      if (!matchesText || !matchesStatus) continue;
      let current: (typeof items)[number] | undefined = item;
      while (current) {
        keep.add(current.id);
        current = current.parentInitiativeId ? byId.get(current.parentInitiativeId) : undefined;
      }
    }
    return ordered.filter((item) => {
      if (!keep.has(item.id)) return false;
      if (needle || statusFilter !== 'all') return true;
      let parentId = item.parentInitiativeId;
      while (parentId) {
        if (collapsed.has(parentId)) return false;
        parentId = byId.get(parentId)?.parentInitiativeId ?? null;
      }
      return true;
    });
  }, [collapsed, data?.items, search, sort, statusFilter]);

  const handleCreated = useCallback(
    (created: { id: string }): void => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.initiatives(orgId) });
      router.push(`/orgs/${orgId}/initiatives/${created.id}`);
    },
    [orgId, queryClient, router],
  );

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-5 p-4 @2xl:p-6 @4xl:p-8">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-on-surface text-h1">{initiativePlural}</h1>
        <Button
          className="min-h-10 gap-1.5"
          onClick={() => {
            setCreateOpen(true);
          }}
        >
          <Plus aria-hidden className="size-4" /> New {initiativeNoun.toLowerCase()}
        </Button>
      </header>

      <CreateInitiativeDialog
        orgId={orgId}
        initiativeNoun={initiativeNoun}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={handleCreated}
      />

      {!overview.isPending && !overview.isError ? (
        <section
          className="bg-surface-container-low flex min-h-28 flex-col rounded-lg p-4 @2xl:p-5"
          aria-label="Needs your attention"
        >
          {currentAttention ? (
            <AttentionSurface
              item={currentAttention}
              orgId={orgId}
              index={attentionIndex % attention.length}
              count={attention.length}
              onPrevious={() => {
                setAttentionIndex((value) => (value - 1 + attention.length) % attention.length);
              }}
              onNext={() => {
                setAttentionIndex((value) => (value + 1) % attention.length);
              }}
            />
          ) : (
            <div>
              <p className="text-on-surface text-sm font-medium">Nothing needs attention</p>
              <p className="text-on-surface-variant mt-1 text-sm">
                No active initiative is at risk, off track, or overdue for an update.
              </p>
            </div>
          )}
        </section>
      ) : null}

      {data && data.items.length > 0 ? (
        <div className="border-outline-variant flex flex-wrap items-center gap-2 border-b pb-3">
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            placeholder={`Filter ${initiativePlural.toLowerCase()}…`}
            aria-label={`Filter ${initiativePlural.toLowerCase()}`}
            className="border-input bg-background h-10 min-w-52 flex-1 rounded-md border px-2 text-sm @2xl:h-8"
          />
          <select
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value as typeof statusFilter);
            }}
            className="border-input bg-background h-10 rounded-md border px-2 text-xs @2xl:h-8"
            aria-label="Filter by status"
          >
            <option value="all">All statuses</option>
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(event) => {
              setSort(event.target.value as typeof sort);
            }}
            className="border-input bg-background h-10 rounded-md border px-2 text-xs @2xl:h-8"
            aria-label="Sort initiatives"
          >
            <option value="title">Sort by title</option>
            <option value="status">Sort by status</option>
            <option value="target">Sort by target</option>
          </select>
        </div>
      ) : null}

      {overview.isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-11 w-full" />
          ))}
        </div>
      ) : overview.isError ? (
        <p role="alert" className="text-destructive text-sm">
          {userErrorMessage(overview.error, 'Could not load initiatives.')}
        </p>
      ) : data && data.items.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm @2xl:min-w-[56rem]">
            <thead className="hidden @2xl:table-header-group">
              <tr className="border-outline-variant text-on-surface-variant border-b text-left text-xs">
                <th className="py-2 font-medium">Initiative</th>
                <th className="py-2 pr-4 font-medium whitespace-nowrap">Status</th>
                <th className="py-2 pr-4 font-medium whitespace-nowrap">Health</th>
                <th className="py-2 pr-4 font-medium whitespace-nowrap">Owner</th>
                <th className="py-2 pr-4 font-medium whitespace-nowrap">Target</th>
                <th className="py-2 font-medium whitespace-nowrap">Last update</th>
              </tr>
            </thead>
            <tbody className="block @2xl:table-row-group">
              {visibleItems.map((item) => (
                <tr
                  key={item.id}
                  className="border-outline-variant/60 hover:bg-surface-container-low block border-b @2xl:table-row"
                  onMouseEnter={() => {
                    prefetch(initiativeDetailDef(item.organizationId, item.id));
                  }}
                >
                  <td className="block min-w-0 py-3 @2xl:table-cell @2xl:pr-4">
                    <div
                      className="flex items-center"
                      style={{ paddingLeft: `${(item.depth - 1) * 24}px` }}
                    >
                      {item.childCount > 0 ? (
                        <button
                          type="button"
                          className="text-on-surface-variant -my-2 mr-1 flex size-10 shrink-0 items-center justify-center @2xl:mr-0 @2xl:size-6"
                          aria-label={`${collapsed.has(item.id) ? 'Expand' : 'Collapse'} ${item.name}`}
                          aria-expanded={!collapsed.has(item.id)}
                          onClick={() => {
                            setCollapsed((current) => {
                              const next = new Set(current);
                              if (next.has(item.id)) next.delete(item.id);
                              else next.add(item.id);
                              return next;
                            });
                          }}
                        >
                          {collapsed.has(item.id) ? '›' : '⌄'}
                        </button>
                      ) : (
                        <span className="mr-1 w-10 shrink-0 @2xl:mr-0 @2xl:w-6" />
                      )}
                      <Link
                        href={`/orgs/${item.organizationId}/initiatives/${item.id}`}
                        className="text-on-surface line-clamp-1 min-w-0 font-medium hover:underline"
                      >
                        {item.name}
                      </Link>
                      {item.organizationId !== orgId ? (
                        <Badge className="ml-2" variant="outline">
                          {item.organizationName}
                        </Badge>
                      ) : null}
                    </div>
                    <p
                      className="text-on-surface-variant mt-1 line-clamp-2 min-h-8 pl-10 text-xs @2xl:mt-0.5 @2xl:pl-6"
                      style={{ marginLeft: `${(item.depth - 1) * 24}px` }}
                    >
                      {item.summary ?? ''}
                    </p>
                    <p className="text-on-surface-variant mt-2 flex flex-wrap gap-x-3 gap-y-1 pl-10 text-xs @2xl:hidden">
                      <span>{STATUS_LABEL[item.status]}</span>
                      <span>{item.health ? HEALTH_LABEL[item.health] : 'No health'}</span>
                      <span>{`Owner ${item.ownerName ?? 'Unassigned'}`}</span>
                      <span>{`Target ${item.targetDate ? item.targetDate.slice(0, 10) : 'No target'}`}</span>
                      <span>
                        {item.lastUpdateAt
                          ? `Updated ${item.lastUpdateAt.slice(0, 10)}`
                          : 'Never updated'}
                      </span>
                    </p>
                  </td>
                  <td className="hidden py-3 pr-4 whitespace-nowrap @2xl:table-cell">
                    {STATUS_LABEL[item.status]}
                  </td>
                  <td className="hidden py-3 pr-4 whitespace-nowrap @2xl:table-cell">
                    {item.health ? HEALTH_LABEL[item.health] : '—'}
                  </td>
                  <td className="hidden py-3 pr-4 whitespace-nowrap @2xl:table-cell">
                    {item.ownerName ?? '—'}
                  </td>
                  <td className="hidden py-3 pr-4 whitespace-nowrap tabular-nums @2xl:table-cell">
                    {item.targetDate ? item.targetDate.slice(0, 10) : '—'}
                  </td>
                  <td className="hidden py-3 whitespace-nowrap tabular-nums @2xl:table-cell">
                    {item.lastUpdateAt ? item.lastUpdateAt.slice(0, 10) : 'Never'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          icon={Target}
          title={`No ${initiativePlural.toLowerCase()} yet`}
          body="Create a strategic theme to connect ongoing programs and bounded projects."
          cta={{
            label: `Create your first ${initiativeNoun.toLowerCase()}`,
            onClick: () => {
              setCreateOpen(true);
            },
          }}
        />
      )}
    </main>
  );
}
