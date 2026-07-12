'use client';

import { Badge, Skeleton } from '@docket/ui/primitives';
import { type JSX, useCallback, useEffect, useState } from 'react';

import { EmptyState, ErrorBanner, PageHeader, SignInAction } from '@/components/ui-bits';
import { api } from '@/lib/api';
import { formatTimestamp } from '@/lib/lifecycle';
import { isAuthError, userErrorMessage, userProblemMessage } from '@/lib/problem';
import type { AdminAuditEvent } from '@/lib/types';

/** Page size for the audit feed. */
const PAGE_SIZE = 100;

/**
 * The operator audit trail.
 *
 * @remarks
 * A Client Component. Reads `GET /admin/audit` (newest first) at runtime. Every operator
 * mutation across the console — holds, billing actions, lifecycle overrides, impersonation —
 * writes an audit event, rendered here with its type, subject, actor, timestamp, and the raw
 * metadata payload. A 403 (non-staff session) surfaces inline.
 */
export default function AuditPage(): JSX.Element {
  const [events, setEvents] = useState<readonly AdminAuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authFailed, setAuthFailed] = useState(false);

  /** Load the most recent page of audit events. */
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    setAuthFailed(false);
    try {
      const res = await api.admin.audit.$get({
        query: { limit: String(PAGE_SIZE), offset: '0' },
      });
      if (!res.ok) {
        setAuthFailed(isAuthError(res));
        setError(await userProblemMessage(res, 'Could not load the audit log.'));
        return;
      }
      setEvents((await res.json()).items);
    } catch (caught) {
      setError(userErrorMessage(caught, 'Something went wrong loading the audit log.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-8">
      <PageHeader title="Audit log" description="Every operator action, newest first." />
      <ErrorBanner message={error} action={authFailed ? <SignInAction /> : null} />

      {loading ? (
        <ListSkeleton />
      ) : events.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {events.map((event) => (
            <li
              key={event.id}
              className="border-outline-variant bg-surface-container-low flex flex-col gap-2 rounded-lg border px-4 py-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{event.type}</Badge>
                  <span className="text-on-surface-variant text-xs">
                    {event.subjectType} · {event.subjectId}
                  </span>
                </div>
                <span className="text-on-surface-variant text-xs">
                  {formatTimestamp(event.createdAt)}
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-on-surface-variant text-xs">
                  Staff: {event.staffUserId ?? 'system'}
                </span>
                {Object.keys(event.metadata).length > 0 ? (
                  <code className="bg-surface-container-high text-on-surface-variant max-w-full truncate rounded px-2 py-0.5 font-mono text-xs">
                    {JSON.stringify(event.metadata)}
                  </code>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState message="No operator actions recorded yet." />
      )}
    </div>
  );
}

/** A loading placeholder for the audit feed. */
function ListSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      {Array.from({ length: 8 }, (_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-lg" />
      ))}
    </div>
  );
}
