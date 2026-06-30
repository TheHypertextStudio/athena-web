'use client';

import { Input, Skeleton } from '@docket/ui/primitives';
import Link from 'next/link';
import { type JSX, useCallback, useEffect, useState } from 'react';

import { EmptyState, ErrorBanner, PageHeader, ROW_CLASS, SignInAction } from '@/components/ui-bits';
import { api } from '@/lib/api';
import { formatTimestamp } from '@/lib/lifecycle';
import { isAuthError, readError, readProblem } from '@/lib/problem';
import type { AdminUser } from '@/lib/types';

/** Page size for the user list. */
const PAGE_SIZE = 50;

/**
 * The user-primary list with debounced search.
 *
 * @remarks
 * A Client Component. Reads `GET /admin/users` (paginated + searchable) at runtime; the
 * search box re-queries on a short debounce. Each row links to the user detail screen. A
 * 403 (non-staff session) surfaces inline.
 */
export default function UsersPage(): JSX.Element {
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState<readonly AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authFailed, setAuthFailed] = useState(false);

  /** Load the first page of users matching the current search term. */
  const load = useCallback(async (term: string): Promise<void> => {
    setLoading(true);
    setError(null);
    setAuthFailed(false);
    try {
      const res = await api.admin.users.$get({
        query: { search: term || undefined, limit: String(PAGE_SIZE), offset: '0' },
      });
      if (!res.ok) {
        setAuthFailed(isAuthError(res));
        setError(await readProblem(res, 'Could not load users.'));
        return;
      }
      const page = await res.json();
      setUsers(page.items);
      setTotal(page.total);
    } catch (caught) {
      setError(readError(caught, 'Something went wrong loading users.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => void load(search), 250);
    return () => {
      clearTimeout(handle);
    };
  }, [search, load]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-8">
      <PageHeader
        title="Users"
        description={loading ? 'Loading…' : `${total} user${total === 1 ? '' : 's'} total`}
        actions={
          <Input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
            placeholder="Search name or email"
            className="w-64"
            aria-label="Search users"
          />
        }
      />
      <ErrorBanner message={error} action={authFailed ? <SignInAction /> : null} />

      {loading ? (
        <ListSkeleton />
      ) : users.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {users.map((u) => (
            <li key={u.id}>
              <Link
                href={`/users/${u.id}`}
                className={`${ROW_CLASS} items-center justify-between gap-4 rounded-lg px-4 py-3`}
              >
                <div className="min-w-0">
                  <p className="text-body truncate font-medium">{u.name || u.email}</p>
                  <p className="text-on-surface-variant truncate text-xs">{u.email}</p>
                </div>
                <span className="text-on-surface-variant shrink-0 text-xs">
                  {formatTimestamp(u.createdAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState message={search ? 'No users match your search.' : 'No users yet.'} />
      )}
    </div>
  );
}

/** A loading placeholder for the user list. */
function ListSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-lg" />
      ))}
    </div>
  );
}
