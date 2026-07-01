'use client';

/**
 * `stream` — the "Ask Athena" drafted-plan panel inside the event drawer.
 *
 * @remarks
 * The chief-of-staff payoff: one click creates an agent session from the event (the same
 * `POST /sessions` create-from-prompt the rest of the app uses), then renders its drafted plan
 * as the shared {@link ActivityItem} stream with per-action **Approve / Reject** — Athena
 * proposes, the user approves each step (approval-gated, never auto-acted). Reuses
 * {@link useSessionDetail} so the approval wiring isn't reinvented here.
 */
import { Sparkles } from '@docket/ui/icons';
import { type JSX, useState } from 'react';

import { ActivityItem } from '@/components/agents/activity-item';
import { api } from '@/lib/api';
import { readError, readProblem } from '@/lib/problem';
import { useSessionDetail } from '@/lib/use-session-detail';

/** Props for {@link AthenaPlan}. */
export interface AthenaPlanProps {
  /** The org the event (and the drafted session) belongs to. */
  readonly orgId: string;
  /** The brief seeded into the session. */
  readonly prompt: string;
}

/** The "Ask Athena" affordance + the drafted-plan approval stream. */
export function AthenaPlan({ orgId, prompt }: AthenaPlanProps): JSX.Element {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await api.v1.orgs[':orgId'].sessions.$post({
        param: { orgId },
        json: { prompt },
      });
      if (!res.ok) {
        setError(await readProblem(res, 'Athena could not draft a plan.'));
        return;
      }
      const session = await res.json();
      setSessionId(session.id);
    } catch (caught) {
      setError(readError(caught, 'Athena could not draft a plan.'));
    } finally {
      setBusy(false);
    }
  }

  if (!sessionId) {
    return (
      <div>
        <button
          type="button"
          onClick={() => void ask()}
          disabled={busy}
          className="text-on-primary inline-flex items-center gap-2 rounded-lg bg-[var(--color-primary)] px-3 py-2 text-sm font-semibold disabled:opacity-50"
        >
          <Sparkles className="h-4 w-4" />
          {busy ? 'Drafting a plan…' : 'Ask Athena to draft a plan'}
        </button>
        {error ? <p className="text-state-error mt-2 text-xs">{error}</p> : null}
      </div>
    );
  }
  return <AthenaPlanStream orgId={orgId} sessionId={sessionId} />;
}

/** The drafted session's plan stream with per-action approval. */
function AthenaPlanStream({ orgId, sessionId }: { orgId: string; sessionId: string }): JSX.Element {
  const detail = useSessionDetail(orgId, sessionId);
  const activities = detail.session?.activities ?? [];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-[var(--color-primary)]" />
        <span className="text-on-surface text-sm font-semibold">Athena’s plan</span>
        <span className="ml-auto rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
          awaiting approval
        </span>
      </div>
      {detail.loading ? <p className="text-on-surface-variant text-xs">Drafting a plan…</p> : null}
      {detail.loadError ? <p className="text-state-error text-xs">{detail.loadError}</p> : null}
      {detail.actionError ? <p className="text-state-error text-xs">{detail.actionError}</p> : null}
      {activities.map((activity) => (
        <ActivityItem
          key={activity.id}
          activity={activity}
          canAct
          pending={detail.pendingActivityId === activity.id}
          onApprove={(id) => {
            void detail.approve(id);
          }}
          onReject={(id) => {
            void detail.reject(id);
          }}
          onReply={(id, body) => {
            void detail.reply(id, body);
          }}
        />
      ))}
    </div>
  );
}
