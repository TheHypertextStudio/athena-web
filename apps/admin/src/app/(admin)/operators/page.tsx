'use client';

import { Badge, Skeleton } from '@docket/ui/primitives';
import { type JSX, useCallback, useEffect, useState } from 'react';

import { EmptyState, ErrorBanner, PageHeader, ROW_CLASS, SignInAction } from '@/components/ui-bits';
import { api } from '@/lib/api';
import { formatTimestamp } from '@/lib/lifecycle';
import { isAuthError, userErrorMessage, userProblemMessage } from '@/lib/problem';
import type { AdminStaff } from '@/lib/types';

/** Page size for the operator roster. Staff counts are small; one page is the whole list. */
const PAGE_SIZE = 100;

/**
 * The operator roster: who holds staff access, at what tier, and what provisions it.
 *
 * @remarks
 * A Client Component reading `GET /admin/staff` (superadmin-only; a lower tier 403s inline).
 *
 * The column that matters is provenance. A `manual` grant is made here and is never touched by
 * the Google Workspace group sync; a `google_group` grant mirrors group membership, so its tier
 * follows the group and revoking it here is undone within minutes. Docket's documented recovery
 * story depends on at least one `manual` superadmin existing — that is the account that still
 * works when the Workspace configuration is itself what broke — and this screen exists so that
 * can be confirmed at a glance rather than by calling the API.
 */
export default function OperatorsPage(): JSX.Element {
  const [operators, setOperators] = useState<readonly AdminStaff[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authFailed, setAuthFailed] = useState(false);

  /** Load the operator roster. */
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    setAuthFailed(false);
    try {
      const res = await api.admin.staff.$get({
        query: { limit: String(PAGE_SIZE), offset: '0' },
      });
      if (!res.ok) {
        setAuthFailed(isAuthError(res));
        setError(await userProblemMessage(res, 'Could not load operators.'));
        return;
      }
      const page = await res.json();
      setOperators(page.items);
      setTotal(page.total);
    } catch (caught) {
      setError(userErrorMessage(caught, 'Something went wrong loading operators.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const breakGlass = operators.filter(
    (o) => o.managedBy === 'manual' && o.role === 'superadmin',
  ).length;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-8">
      <PageHeader
        title="Operators"
        description={
          loading ? 'Loading…' : `${total} operator${total === 1 ? '' : 's'} with staff access`
        }
      />
      <ErrorBanner message={error} action={authFailed ? <SignInAction /> : null} />

      {!loading && !error && breakGlass === 0 ? (
        <p role="status" className="text-on-surface-variant text-body-medium">
          No manually granted superadmin remains. Every superadmin here is provisioned from a Google
          Workspace group, so a broken Workspace configuration would leave nobody able to restore
          access. Grant one operator superadmin from this console to keep a way back in.
        </p>
      ) : null}

      {loading ? (
        <ListSkeleton />
      ) : operators.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {operators.map((operator) => (
            <li key={operator.id}>
              <div
                className={`${ROW_CLASS} items-center justify-between gap-4 rounded-lg px-4 py-3`}
              >
                <div className="min-w-0">
                  {/* The name's emphasis comes from the role token, not a raw weight utility:
                      `title-small` carries its own weight, so the MD3 scale is not forked. */}
                  <p className="text-title-small truncate">
                    {operator.userName || operator.userEmail}
                  </p>
                  <p className="text-on-surface-variant text-body-small truncate">
                    {operator.userEmail}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="secondary">{operator.role}</Badge>
                  <ProvenanceBadge operator={operator} />
                  <span className="text-on-surface-variant text-label-small hidden sm:inline">
                    {formatTimestamp(operator.createdAt)}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState message="No operators yet." />
      )}
    </div>
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

/** A loading placeholder for the roster. */
function ListSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-lg" />
      ))}
    </div>
  );
}
