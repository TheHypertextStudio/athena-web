'use client';

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Skeleton,
} from '@docket/ui/primitives';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { type JSX, useCallback, useEffect, useState } from 'react';

import { useImpersonation } from '@/components/impersonation';
import {
  EmptyState,
  ErrorBanner,
  LifecycleBadge,
  PageHeader,
  ROW_CLASS,
  SignInAction,
} from '@/components/ui-bits';
import { api } from '@/lib/api';
import { formatTimestamp } from '@/lib/lifecycle';
import { isAuthError, readError, readProblem } from '@/lib/problem';
import type { AdminUserDetail } from '@/lib/types';

/** Default impersonation session lifetime, in minutes (the API caps this at 480). */
const IMPERSONATION_TTL_MINUTES = 60;

/**
 * The user detail screen: a user and their org memberships, with an inline "View as"
 * (impersonation) action.
 *
 * @remarks
 * A Client Component. Reads `GET /v1/admin/users/:id` (the user plus every cross-org
 * membership) at runtime. The "View as" control starts a time-boxed impersonation via
 * `POST /v1/admin/impersonations` (requires a free-text reason) and records it in the
 * {@link useImpersonation} context so the persistent banner appears across the console.
 */
export default function UserDetailPage(): JSX.Element {
  const params = useParams<{ id: string }>();
  const { start: startImpersonation } = useImpersonation();
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authFailed, setAuthFailed] = useState(false);

  const [reason, setReason] = useState('');
  const [impersonating, setImpersonating] = useState(false);
  const [impersonateError, setImpersonateError] = useState<string | null>(null);

  /** Load the user and their memberships. */
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    setAuthFailed(false);
    try {
      const res = await api.v1.admin.users[':id'].$get({ param: { id: params.id } });
      if (!res.ok) {
        setAuthFailed(isAuthError(res));
        setError(await readProblem(res, 'Could not load this user.'));
        return;
      }
      setDetail(await res.json());
    } catch (caught) {
      setError(readError(caught, 'Something went wrong loading this user.'));
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Start a time-boxed impersonation of this user, with the entered reason. */
  async function viewAs(): Promise<void> {
    if (!detail) return;
    setImpersonateError(null);
    setImpersonating(true);
    try {
      const res = await api.v1.admin.impersonations.$post({
        json: { targetUserId: detail.user.id, reason, ttlMinutes: IMPERSONATION_TTL_MINUTES },
      });
      if (!res.ok) {
        setImpersonateError(await readProblem(res, 'Could not start impersonation.'));
        return;
      }
      const session = await res.json();
      startImpersonation({
        id: session.id,
        targetUserId: session.targetUserId,
        targetLabel: detail.user.name || detail.user.email,
        expiresAt: session.expiresAt,
      });
      setReason('');
    } catch (caught) {
      setImpersonateError(readError(caught, 'Something went wrong starting impersonation.'));
    } finally {
      setImpersonating(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-8">
      <Link
        href="/users"
        className="text-on-surface-variant hover:text-on-surface focus-visible:ring-ring w-fit rounded-sm text-sm underline-offset-4 transition-colors hover:underline focus-visible:ring-1 focus-visible:outline-none"
      >
        ← Back to users
      </Link>

      {loading ? (
        <DetailSkeleton />
      ) : detail ? (
        <>
          <PageHeader
            title={detail.user.name || detail.user.email}
            description={detail.user.email}
          />
          <ErrorBanner message={error} />

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Account</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
              <Field label="User ID" value={detail.user.id} mono />
              <Field label="Email verified" value={detail.user.emailVerified ? 'Yes' : 'No'} />
              <Field label="Joined" value={formatTimestamp(detail.user.createdAt)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">View as user</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-on-surface-variant text-sm">
                Start a time-boxed impersonation session. A reason is recorded in the audit log.
              </p>
              <ErrorBanner message={impersonateError} />
              <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  void viewAs();
                }}
              >
                <Input
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                  }}
                  placeholder="Reason for impersonation"
                  required
                  aria-label="Reason for impersonation"
                  className="flex-1"
                />
                <Button type="submit" disabled={impersonating || reason.trim().length === 0}>
                  {impersonating ? 'Starting…' : 'View as'}
                </Button>
              </form>
            </CardContent>
          </Card>

          <section className="flex flex-col gap-3" aria-labelledby="memberships-heading">
            <h2 id="memberships-heading" className="text-on-surface-variant text-sm font-medium">
              Organization memberships ({detail.memberships.length})
            </h2>
            {detail.memberships.length > 0 ? (
              <ul className="flex flex-col gap-1.5">
                {detail.memberships.map((m) => (
                  <li key={m.actorId}>
                    <Link
                      href={`/orgs/${m.organizationId}`}
                      className={`${ROW_CLASS} items-center justify-between gap-3 rounded-lg px-4 py-3`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{m.organizationName}</p>
                        <p className="text-on-surface-variant truncate text-xs">
                          {m.organizationSlug}
                        </p>
                      </div>
                      <LifecycleBadge state={m.lifecycleState} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState message="This user has no organization memberships." />
            )}
          </section>
        </>
      ) : (
        <ErrorBanner message={error} action={authFailed ? <SignInAction /> : null} />
      )}
    </div>
  );
}

/** A labeled read-only field in the account card. */
function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-on-surface-variant text-xs tracking-wide uppercase">{label}</span>
      <span className={`text-sm ${mono ? 'truncate font-mono text-xs' : ''}`} title={value}>
        {value}
      </span>
    </div>
  );
}

/** A loading placeholder for the user detail screen. */
function DetailSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-8 w-64 rounded-md" />
      <Skeleton className="h-28 w-full rounded-lg" />
      <Skeleton className="h-28 w-full rounded-lg" />
    </div>
  );
}
