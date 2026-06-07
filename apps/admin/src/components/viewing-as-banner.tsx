'use client';

import { Button } from '@docket/ui/primitives';
import { type JSX, useState } from 'react';

import { useImpersonation } from '@/components/impersonation';
import { api } from '@/lib/api';
import { formatTimestamp } from '@/lib/lifecycle';
import { readError, readProblem } from '@/lib/problem';

/**
 * The persistent "viewing as" banner, shown whenever an impersonation session is active.
 *
 * @remarks
 * Reads the active session from the {@link useImpersonation} context (persisted across
 * navigation) and pins a high-contrast bar to the top of the shell so an operator is never
 * unaware they are impersonating. The "End session" action calls
 * `POST /v1/admin/impersonations/:id/end` and, on success, clears the local session so the
 * banner disappears. Renders nothing when no impersonation is active.
 */
export function ViewingAsBanner(): JSX.Element | null {
  const { active, clear } = useImpersonation();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!active) return null;

  /** End the active impersonation server-side, then clear the local banner state. */
  async function end(): Promise<void> {
    if (!active) return;
    setError(null);
    setPending(true);
    try {
      const res = await api.v1.admin.impersonations[':id'].end.$post({ param: { id: active.id } });
      if (!res.ok) {
        setError(await readProblem(res, 'Could not end the impersonation session.'));
        return;
      }
      clear();
    } catch (caught) {
      setError(readError(caught, 'Something went wrong ending the session.'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/15 px-6 py-2.5 text-sm"
    >
      <p className="text-amber-900 dark:text-amber-200">
        <span className="font-semibold">Viewing as {active.targetLabel}</span>
        <span className="text-amber-900/70 dark:text-amber-200/70">
          {' '}
          · expires {formatTimestamp(active.expiresAt)}
        </span>
        {error ? <span className="text-destructive ml-2">{error}</span> : null}
      </p>
      <Button variant="outline" size="sm" disabled={pending} onClick={() => void end()}>
        {pending ? 'Ending…' : 'End session'}
      </Button>
    </div>
  );
}
