'use client';

/**
 * `today/today-prompt` — the hybrid capture / ask-Athena box at the top of Today.
 *
 * @remarks
 * The single entry point for getting work INTO Docket from the daily surface, wiring the
 * two backend paths that already exist:
 *
 * - **Capture** (`POST /v1/orgs/:orgId/capture`) — the default. Free text becomes a real
 *   task in the active workspace (its default team's entry state, attached to the live
 *   cycle when one covers today). `Enter` submits.
 * - **Ask Athena** (`POST /v1/orgs/:orgId/sessions`) — the escalation. The same text
 *   becomes an agent session brief; on success we navigate straight into the live
 *   session view. `⌘Enter` submits.
 *
 * The box always names the workspace it will write into (the active workspace), so the
 * cross-org Today surface is never ambiguous about where a thought lands.
 *
 * **Firehose onboarding**: on an EMPTY workspace (no tasks yet) the box takes center
 * stage as "What's on your plate?" — paste anything (a braindump, meeting notes, a
 * backlog) or ask Athena to import from a connected app; she reads it, proposes the
 * workspace as reviewable ghosts, and nothing lands until you approve. Same engine,
 * same doors — the empty state just leads with the Athena door.
 */
import type { SessionStatus } from '@docket/types';
import { ArrowRight, Sparkles } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type JSX, type KeyboardEvent, useCallback, useState } from 'react';

import { SessionStatusPill } from '@/components/agents/session-status';
import { api } from '@/lib/api';
import { readError, readProblem } from '@/lib/problem';
import { STALE, apiQueryOptions, useApiQuery } from '@/lib/query';
import { queryKeys } from '@/lib/query-keys';

/** A just-created Athena job session, tracked inline instead of navigating away from Today. */
interface AthenaSessionNotice {
  id: string;
  orgId: string;
  status: SessionStatus;
}

/** A successful capture: enough to confirm AND point at the created task. */
interface CaptureNotice {
  /** The created task's title (echoed so the confirmation feels concrete). */
  title: string;
  /** Where the task lives, for the follow-the-work link. */
  href: string;
}

/** Props for {@link TodayPrompt}. */
export interface TodayPromptProps {
  /** The active workspace's org id (capture/session target); `null` before resolution. */
  orgId: string | null;
  /** The active workspace's display name (shown so the target is explicit). */
  orgLabel: string;
  /** Invoked after a successful capture so the host can refresh the plan. */
  onCaptured?: () => void;
}

/** The hybrid prompt box: capture a task, or hand the thought to Athena. */
export function TodayPrompt({ orgId, orgLabel, onCaptured }: TodayPromptProps): JSX.Element {
  const router = useRouter();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'capture' | 'athena' | null>(null);
  const [notice, setNotice] = useState<CaptureNotice | null>(null);
  const [athenaSession, setAthenaSession] = useState<AthenaSessionNotice | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Detect the fresh-workspace moment: zero tasks flips the box into its onboarding
  // framing ("What's on your plate?"). Rides the typed query layer; while unresolved
  // (or on failure) the everyday framing shows — never a flash of onboarding.
  const boundOrgId = orgId ?? '';
  const tasksProbe = useApiQuery(
    apiQueryOptions(
      queryKeys.tasks(boundOrgId),
      () => api.v1.orgs[':orgId'].tasks.$get({ param: { orgId: boundOrgId }, query: {} }),
      'Could not check the workspace.',
      { staleTime: STALE.static, enabled: orgId !== null },
    ),
  );
  const emptyWorkspace = orgId !== null && tasksProbe.data?.items.length === 0;

  const canSubmit = orgId !== null && text.trim().length > 0 && busy === null;

  const capture = useCallback(async (): Promise<void> => {
    if (!orgId || !text.trim()) return;
    setBusy('capture');
    setError(null);
    setNotice(null);
    setAthenaSession(null);
    try {
      const res = await api.v1.orgs[':orgId'].capture.$post({
        param: { orgId },
        json: { text: text.trim() },
      });
      if (!res.ok) {
        setError(await readProblem(res, 'Could not capture that.'));
        return;
      }
      const created = await res.json();
      setText('');
      setNotice({
        title: created.title,
        href: `/orgs/${orgId}/tasks/${created.id}`,
      });
      onCaptured?.();
    } catch (caught) {
      setError(readError(caught, 'Could not capture that.'));
    } finally {
      setBusy(null);
    }
  }, [orgId, orgLabel, text, onCaptured]);

  const askAthena = useCallback(async (): Promise<void> => {
    if (!orgId || !text.trim()) return;
    setBusy('athena');
    setError(null);
    setNotice(null);
    setAthenaSession(null);
    try {
      const res = await api.v1.orgs[':orgId'].sessions.$post({
        param: { orgId },
        json: { prompt: text.trim() },
      });
      if (!res.ok) {
        setError(await readProblem(res, 'Athena could not take that on.'));
        return;
      }
      const session = await res.json();
      // The firehose-onboarding moment (empty workspace) has its own dedicated full-page
      // review — that flow is unchanged. An everyday ask stays on Today: the session is
      // tracked inline instead of navigating away, so asking Athena something never feels
      // like leaving the page you were on.
      if (emptyWorkspace) {
        router.push(`/orgs/${orgId}/sessions/${session.id}`);
        return;
      }
      setText('');
      setAthenaSession({ id: session.id, orgId, status: session.status });
    } catch (caught) {
      setError(readError(caught, 'Athena could not take that on.'));
    } finally {
      setBusy(null);
    }
  }, [orgId, text, router, emptyWorkspace]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): void => {
      if (event.key !== 'Enter' || event.shiftKey) return;
      event.preventDefault();
      if (!canSubmit) return;
      // On an empty workspace the Athena door leads: plain Enter hands the firehose to
      // her (⌘Enter still does everywhere).
      if (event.metaKey || event.ctrlKey || emptyWorkspace) void askAthena();
      else void capture();
    },
    [canSubmit, capture, askAthena, emptyWorkspace],
  );

  return (
    <div className="flex flex-col gap-2">
      {emptyWorkspace ? (
        <div className="flex flex-col gap-1 px-1 pb-2">
          <h2 className="text-on-surface text-2xl font-semibold">What&apos;s on your plate?</h2>
          <p className="text-on-surface-variant text-body">
            Paste anything — a braindump, meeting notes, a whole backlog — or ask Athena to import
            from a connected app. She&apos;ll propose your workspace; nothing lands until you
            approve it.
          </p>
        </div>
      ) : null}
      <div className="border-outline-variant bg-surface-container-low focus-within:ring-ring focus-within:border-ring flex flex-col gap-3 rounded-2xl border p-4 shadow-sm transition-[box-shadow,border-color] duration-(--dur-base) ease-(--ease-out) focus-within:shadow-md focus-within:ring-1 @2xl:p-5">
        <textarea
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            if (notice) setNotice(null);
            if (athenaSession) setAthenaSession(null);
          }}
          onKeyDown={onKeyDown}
          rows={text.includes('\n') || text.length > 90 ? 3 : 2}
          placeholder={
            emptyWorkspace
              ? 'Paste your firehose here — Athena will sort it out…'
              : 'Capture a task, paste a plan, or ask Athena…'
          }
          aria-label="Capture a task or ask Athena"
          disabled={orgId === null}
          className="placeholder:text-on-surface-variant text-on-surface w-full resize-none bg-transparent text-base leading-relaxed outline-none disabled:opacity-50 @2xl:text-lg"
        />
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <span className="text-on-surface-variant order-2 min-w-0 basis-full truncate text-sm @lg:order-1 @lg:basis-auto">
            into <span className="text-on-surface font-medium">{orgLabel}</span>
          </span>
          <div className="order-1 flex shrink-0 items-center gap-2 @lg:order-2">
            <Button
              type="button"
              variant={emptyWorkspace ? 'default' : 'ghost'}
              disabled={!canSubmit}
              onClick={() => {
                void askAthena();
              }}
            >
              <Sparkles className={busy === 'athena' ? 'animate-pulse' : undefined} />
              {busy === 'athena' ? 'Handing off…' : 'Ask Athena'}
              <kbd className="text-on-surface-variant ml-1 hidden font-mono text-[10px] sm:inline">
                ⌘↵
              </kbd>
            </Button>
            <Button
              type="button"
              variant={emptyWorkspace ? 'ghost' : 'default'}
              disabled={!canSubmit}
              onClick={() => {
                void capture();
              }}
            >
              {busy === 'capture' ? 'Adding…' : 'Add task'}
              <ArrowRight />
            </Button>
          </div>
        </div>
      </div>
      <div aria-live="polite" className="min-h-4 px-1">
        {error ? (
          <p className="text-destructive text-sm">{error}</p>
        ) : notice ? (
          <p className="text-on-surface-variant text-sm">
            Added <span className="text-on-surface font-medium">“{notice.title}”</span> to{' '}
            {orgLabel} —{' '}
            <Link
              href={notice.href}
              className="text-on-surface hover:text-primary font-medium underline underline-offset-4 transition-colors"
            >
              view task
            </Link>
          </p>
        ) : null}
      </div>
      {athenaSession ? (
        <div className="border-outline-variant bg-surface-container-low flex items-center justify-between gap-3 rounded-xl border px-4 py-3">
          <span className="flex min-w-0 items-center gap-2">
            <SessionStatusPill status={athenaSession.status} />
            <span className="text-on-surface-variant text-sm">Athena is on it</span>
          </span>
          <Link
            href={`/orgs/${athenaSession.orgId}/sessions/${athenaSession.id}`}
            className="text-on-surface hover:text-primary shrink-0 text-sm font-medium underline underline-offset-4 transition-colors"
          >
            View session
          </Link>
        </div>
      ) : null}
    </div>
  );
}
