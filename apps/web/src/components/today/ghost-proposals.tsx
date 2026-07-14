'use client';

/**
 * Athena's pending proposals, ghosted into Today (the ghost system's workspace side).
 *
 * @remarks
 * Every session parked `awaiting_approval` in the active org contributes its proposal
 * groups here, rendered in the ghost grammar — translucent, dashed-accent task rows
 * that are unmistakably *not real yet*. Approving a batch executes it and the rows
 * solidify into real work (each ghost carries a stable `view-transition-name`, so the
 * morph happens in place rather than a view swap). Quiet by design: the lane renders
 * nothing at all when there is nothing to review.
 */
import type { ProposalGroupOut } from '@docket/types';
import { Button } from '@docket/ui/primitives';
import Link from 'next/link';
import { type JSX, useCallback, useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { userErrorMessage, readProblemError } from '@/lib/problem';
import { startViewTransition } from '@/lib/view-transition';

/** One session's pending groups, tagged with where to review them in full. */
interface SessionProposals {
  readonly sessionId: string;
  readonly groups: readonly ProposalGroupOut[];
}

/** Props for {@link GhostProposals}. */
export interface GhostProposalsProps {
  /** The active org (the lane hides itself without one). */
  orgId: string | null;
  /** Refresh the surrounding Today data after a batch lands. */
  onApplied: () => void;
}

/**
 * The Today ghost lane: pending Athena proposals, approvable in place.
 */
export function GhostProposals({ orgId, onApplied }: GhostProposalsProps): JSX.Element | null {
  const [items, setItems] = useState<readonly SessionProposals[]>([]);
  const [pendingGroupId, setPendingGroupId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!orgId) {
      setItems([]);
      return;
    }
    try {
      const sessionsRes = await api.v1.orgs[':orgId'].sessions.$get({
        param: { orgId },
        query: { status: 'awaiting_approval' },
      });
      if (!sessionsRes.ok) return;
      const { items: sessions } = await sessionsRes.json();
      const withGroups = await Promise.all(
        sessions.map(async (session): Promise<SessionProposals> => {
          const res = await api.v1.orgs[':orgId'].sessions[':id'].proposals.$get({
            param: { orgId, id: session.id },
          });
          return { sessionId: session.id, groups: res.ok ? await res.json() : [] };
        }),
      );
      const next = withGroups.filter((entry) => entry.groups.length > 0);
      // Each ghost row carries a stable `view-transition-name` — commit inside a View Transition
      // so an approved batch's rows morph out of the lane in place instead of popping.
      startViewTransition(() => {
        setItems(next);
      });
    } catch {
      // A failed poll leaves the lane as it was; Today stays calm.
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const approveAll = useCallback(
    async (sessionId: string, groupId: string): Promise<void> => {
      if (!orgId) return;
      setError(null);
      setPendingGroupId(groupId);
      try {
        const res = await api.v1.orgs[':orgId'].sessions[':id'].proposals[':groupId'].approve.$post(
          { param: { orgId, id: sessionId, groupId }, json: {} },
        );
        if (!res.ok) {
          setError(
            userErrorMessage(
              await readProblemError(res, 'Could not approve the batch.'),
              'Could not approve the batch.',
            ),
          );
          return;
        }
        await load();
        onApplied();
      } catch (caught) {
        setError(userErrorMessage(caught, 'Something went wrong approving the batch.'));
      } finally {
        setPendingGroupId(null);
      }
    },
    [orgId, load, onApplied],
  );

  if (!orgId || items.length === 0) return null;

  return (
    <section aria-label="Proposed by Athena" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-on-surface-variant text-sm font-medium">Proposed by Athena</h2>
        <span className="text-on-surface-variant/70 text-xs">
          Nothing is real until you approve it
        </span>
      </div>

      {error ? (
        <p role="alert" className="text-destructive text-body-medium">
          {error}
        </p>
      ) : null}

      {items.flatMap((entry) =>
        entry.groups.map((group) => (
          <div
            key={group.proposalGroupId}
            className="border-primary/30 bg-surface/60 rounded-xl border border-dashed p-3"
          >
            <ul className="flex flex-col gap-1">
              {group.items.map((item) => (
                <li
                  key={item.activityId}
                  style={{ viewTransitionName: `proposal-${item.activityId}` }}
                  className="text-on-surface/80 text-body-medium flex items-center gap-2 truncate px-1 py-0.5"
                >
                  <span className="bg-primary/50 h-1.5 w-1.5 shrink-0 rounded-full" />
                  <span className="min-w-0 truncate">{item.ghost?.title ?? item.summary}</span>
                  {item.ghost?.dueDate ? (
                    <span className="text-on-surface-variant shrink-0 text-xs">
                      {item.ghost.dueDate}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            <div className="mt-2.5 flex items-center gap-2">
              <Button
                size="sm"
                disabled={pendingGroupId === group.proposalGroupId}
                onClick={() => {
                  void approveAll(entry.sessionId, group.proposalGroupId);
                }}
              >
                {pendingGroupId === group.proposalGroupId
                  ? 'Applying…'
                  : `Approve ${String(group.items.length)}`}
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href={`/orgs/${orgId}/sessions/${entry.sessionId}`}>Review in session</Link>
              </Button>
            </div>
          </div>
        )),
      )}
    </section>
  );
}
