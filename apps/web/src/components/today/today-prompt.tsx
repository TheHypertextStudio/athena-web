'use client';

/**
 * `today/today-prompt` — the hybrid capture / ask-Athena box at the top of Today.
 *
 * @remarks
 * The single entry point for getting work INTO Docket from the daily surface, wiring the
 * the direct capture path and the one shared personal Athena dock:
 *
 * - **Capture** (`POST /v1/orgs/:orgId/capture`) — the default. Free text becomes a real
 *   task in the active workspace (its default team's entry state, attached to the live
 *   cycle when one covers today). `Enter` submits.
 * - **Ask Athena** opens the global personal dock with this workspace and draft attached. The dock
 *   creates and supervises the work; Today does not grow its own mini session UI.
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
import { ArrowRight, Sparkles } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import Link from 'next/link';
import { type JSX, type KeyboardEvent, useCallback, useState } from 'react';

import { useAthenaPanel } from '@/components/athena/athena-panel-provider';
import { api } from '@/lib/api';
import { userErrorMessage, readProblemError } from '@/lib/problem';
import { STALE, apiQueryOptions, useApiQuery } from '@/lib/query';
import { queryKeys } from '@/lib/query-keys';

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
  const { openAthena } = useAthenaPanel();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'capture' | null>(null);
  const [notice, setNotice] = useState<CaptureNotice | null>(null);
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
    try {
      const res = await api.v1.orgs[':orgId'].capture.$post({
        param: { orgId },
        json: { text: text.trim() },
      });
      if (!res.ok) {
        setError(
          userErrorMessage(
            await readProblemError(res, 'Could not capture that.'),
            'Could not capture that.',
          ),
        );
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
      setError(userErrorMessage(caught, 'Could not capture that.'));
    } finally {
      setBusy(null);
    }
  }, [orgId, orgLabel, text, onCaptured]);

  const askAthena = useCallback((): void => {
    if (!orgId || !text.trim()) return;
    setError(null);
    setNotice(null);
    openAthena({ workspaceId: orgId, workspaceName: orgLabel }, text.trim());
    setText('');
  }, [openAthena, orgId, orgLabel, text]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): void => {
      if (event.key !== 'Enter' || event.shiftKey) return;
      event.preventDefault();
      if (!canSubmit) return;
      // On an empty workspace the Athena door leads: plain Enter hands the firehose to
      // her (⌘Enter still does everywhere).
      if (event.metaKey || event.ctrlKey || emptyWorkspace) askAthena();
      else void capture();
    },
    [canSubmit, capture, askAthena, emptyWorkspace],
  );

  return (
    <div className="flex flex-col gap-2">
      {emptyWorkspace ? (
        <div className="flex flex-col gap-1 px-1 pb-2">
          <h2 className="text-on-surface text-2xl font-semibold">What&apos;s on your plate?</h2>
          <p className="text-on-surface-variant text-body-medium">
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
                askAthena();
              }}
            >
              <Sparkles />
              Ask Athena
              <kbd className="text-on-surface-variant ml-1 hidden font-mono text-[10px] @lg:inline">
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
    </div>
  );
}
