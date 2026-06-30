'use client';

import { Skeleton } from '@docket/ui/primitives';
import Link from 'next/link';
import { type JSX, useCallback, useEffect, useState } from 'react';

import { EmptyState, ErrorBanner, PageHeader, ROW_CLASS, SignInAction } from '@/components/ui-bits';
import { api } from '@/lib/api';
import { formatTimestamp, lifecycleLabel } from '@/lib/lifecycle';
import { isAuthError, readError, readProblem } from '@/lib/problem';
import type { AdminLifecycleBoard } from '@/lib/types';

/**
 * The data-lifecycle pipeline board.
 *
 * @remarks
 * A Client Component. Reads `GET /admin/lifecycle` at runtime — one column per lifecycle
 * state (trial → active → past due → export window → pending deletion → deleted), each
 * holding the orgs currently in that state. Cards link to the org detail screen. A 403
 * (non-staff session) surfaces inline. The column layout scrolls horizontally on narrow
 * viewports so every stage stays reachable.
 */
export default function LifecyclePage(): JSX.Element {
  const [board, setBoard] = useState<AdminLifecycleBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authFailed, setAuthFailed] = useState(false);

  /** Load the lifecycle board. */
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    setAuthFailed(false);
    try {
      const res = await api.admin.lifecycle.$get();
      if (!res.ok) {
        setAuthFailed(isAuthError(res));
        setError(await readProblem(res, 'Could not load the lifecycle board.'));
        return;
      }
      setBoard(await res.json());
    } catch (caught) {
      setError(readError(caught, 'Something went wrong loading the lifecycle board.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex w-full flex-col gap-6 p-8">
      <PageHeader
        title="Data lifecycle"
        description="Every organization by its position in the data-retention pipeline."
      />
      <ErrorBanner message={error} action={authFailed ? <SignInAction /> : null} />

      {loading ? (
        <BoardSkeleton />
      ) : board ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {board.columns.map((column) => (
            <section
              key={column.lifecycleState}
              className="border-outline-variant bg-surface-container flex w-72 shrink-0 flex-col gap-3 rounded-lg border p-3"
              aria-label={lifecycleLabel(column.lifecycleState)}
            >
              <header className="flex items-center justify-between">
                <h2 className="text-on-surface text-body font-medium">
                  {lifecycleLabel(column.lifecycleState)}
                </h2>
                <span className="bg-surface-container-highest text-on-surface-variant rounded-full px-2 py-0.5 text-xs tabular-nums">
                  {column.orgs.length}
                </span>
              </header>
              {column.orgs.length > 0 ? (
                <ul className="flex flex-col gap-1.5">
                  {column.orgs.map((org) => (
                    <li key={org.id}>
                      <Link
                        href={`/orgs/${org.id}`}
                        className={`${ROW_CLASS} flex-col gap-1 rounded-md px-3 py-2`}
                      >
                        <span className="text-body truncate font-medium">{org.name}</span>
                        <span className="text-on-surface-variant truncate text-xs">
                          {org.deleteAfterAt
                            ? `Delete after ${formatTimestamp(org.deleteAfterAt)}`
                            : org.exportReadyAt
                              ? `Export ready ${formatTimestamp(org.exportReadyAt)}`
                              : org.slug}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState message="Empty" />
              )}
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** A loading placeholder for the lifecycle board. */
function BoardSkeleton(): JSX.Element {
  return (
    <div className="flex gap-4 overflow-hidden">
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-64 w-72 shrink-0 rounded-lg" />
      ))}
    </div>
  );
}
