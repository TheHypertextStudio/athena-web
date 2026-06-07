'use client';

import { Input, Skeleton } from '@docket/ui/primitives';
import Link from 'next/link';
import { type JSX, useCallback, useEffect, useState } from 'react';

import { EmptyState, ErrorBanner, LifecycleBadge, PageHeader } from '@/components/ui-bits';
import { api } from '@/lib/api';
import { LIFECYCLE_STATES, type LifecycleState, lifecycleLabel } from '@/lib/lifecycle';
import { readError, readProblem } from '@/lib/problem';
import type { AdminOrg } from '@/lib/types';

/** Page size for the org list. */
const PAGE_SIZE = 50;

/** The "all states" sentinel for the lifecycle filter select. */
const ALL_STATES = 'all';

/**
 * The organization list with search and a lifecycle-state filter.
 *
 * @remarks
 * A Client Component. Reads `GET /v1/admin/orgs` (paginated, searchable, lifecycle-
 * filterable) at runtime; search debounces, the filter re-queries immediately. Each row
 * links to the org detail screen and shows its current lifecycle state. A 403 (non-staff
 * session) surfaces inline.
 */
export default function OrgsPage(): JSX.Element {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<LifecycleState | typeof ALL_STATES>(ALL_STATES);
  const [orgs, setOrgs] = useState<readonly AdminOrg[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Load the first page of orgs matching the current search + filter. */
  const load = useCallback(
    async (term: string, state: LifecycleState | typeof ALL_STATES): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.v1.admin.orgs.$get({
          query: {
            search: term || undefined,
            lifecycleState: state === ALL_STATES ? undefined : state,
            limit: String(PAGE_SIZE),
            offset: '0',
          },
        });
        if (!res.ok) {
          setError(await readProblem(res, 'Could not load organizations.'));
          return;
        }
        const page = await res.json();
        setOrgs(page.items);
        setTotal(page.total);
      } catch (caught) {
        setError(readError(caught, 'Something went wrong loading organizations.'));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    const handle = setTimeout(() => void load(search, filter), 250);
    return () => {
      clearTimeout(handle);
    };
  }, [search, filter, load]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-8">
      <PageHeader
        title="Organizations"
        description={loading ? 'Loading…' : `${total} organization${total === 1 ? '' : 's'} total`}
        actions={
          <>
            <select
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value as LifecycleState | typeof ALL_STATES);
              }}
              aria-label="Filter by lifecycle state"
              className="border-input focus-visible:ring-ring h-9 rounded-md border bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1"
            >
              <option value={ALL_STATES}>All states</option>
              {LIFECYCLE_STATES.map((state) => (
                <option key={state} value={state}>
                  {lifecycleLabel(state)}
                </option>
              ))}
            </select>
            <Input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
              placeholder="Search name or slug"
              className="w-56"
              aria-label="Search organizations"
            />
          </>
        }
      />
      <ErrorBanner message={error} />

      {loading ? (
        <ListSkeleton />
      ) : orgs.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {orgs.map((org) => (
            <li key={org.id}>
              <Link
                href={`/orgs/${org.id}`}
                className="border-border bg-card hover:bg-accent/50 flex items-center justify-between gap-4 rounded-lg border px-4 py-3 transition-colors"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{org.name}</p>
                  <p className="text-muted-foreground truncate text-xs">{org.slug}</p>
                </div>
                <LifecycleBadge state={org.lifecycleState} />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState message="No organizations match these filters." />
      )}
    </div>
  );
}

/** A loading placeholder for the org list. */
function ListSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-lg" />
      ))}
    </div>
  );
}
