'use client';

import { Input, Skeleton } from '@docket/ui/primitives';
import Link from 'next/link';
import { type JSX, useCallback, useEffect, useState } from 'react';

import {
  ALL_STATES,
  LifecycleFilter,
  type LifecycleFilterValue,
} from '@/components/lifecycle-filter';
import {
  EmptyState,
  ErrorBanner,
  LifecycleBadge,
  PageHeader,
  ROW_CLASS,
  SignInAction,
} from '@/components/ui-bits';
import { api } from '@/lib/api';
import { isAuthError, userErrorMessage, userProblemMessage } from '@/lib/problem';
import type { AdminOrg } from '@/lib/types';

/** Page size for the org list. */
const PAGE_SIZE = 50;

/**
 * The organization list with search and a lifecycle-state filter.
 *
 * @remarks
 * A Client Component. Reads `GET /admin/orgs` (paginated, searchable, lifecycle-
 * filterable) at runtime; search debounces, the filter re-queries immediately. Each row
 * links to the org detail screen and shows its current lifecycle state. A 403 (non-staff
 * session) surfaces inline.
 */
export default function OrgsPage(): JSX.Element {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<LifecycleFilterValue>(ALL_STATES);
  const [orgs, setOrgs] = useState<readonly AdminOrg[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authFailed, setAuthFailed] = useState(false);

  /** Load the first page of orgs matching the current search + filter. */
  const load = useCallback(async (term: string, state: LifecycleFilterValue): Promise<void> => {
    setLoading(true);
    setError(null);
    setAuthFailed(false);
    try {
      const res = await api.admin.orgs.$get({
        query: {
          search: term || undefined,
          lifecycleState: state === ALL_STATES ? undefined : state,
          limit: String(PAGE_SIZE),
          offset: '0',
        },
      });
      if (!res.ok) {
        setAuthFailed(isAuthError(res));
        setError(await userProblemMessage(res, 'Could not load organizations.'));
        return;
      }
      const page = await res.json();
      setOrgs(page.items);
      setTotal(page.total);
    } catch (caught) {
      setError(userErrorMessage(caught, 'Something went wrong loading organizations.'));
    } finally {
      setLoading(false);
    }
  }, []);

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
            <LifecycleFilter value={filter} onChange={setFilter} />
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
      <ErrorBanner message={error} action={authFailed ? <SignInAction /> : null} />

      {loading ? (
        <ListSkeleton />
      ) : orgs.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {orgs.map((org) => (
            <li key={org.id}>
              <Link
                href={`/orgs/${org.id}`}
                className={`${ROW_CLASS} items-center justify-between gap-4 rounded-lg px-4 py-3`}
              >
                <div className="min-w-0">
                  <p className="text-body-medium truncate font-medium">{org.name}</p>
                  <p className="text-on-surface-variant truncate text-xs">{org.slug}</p>
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
