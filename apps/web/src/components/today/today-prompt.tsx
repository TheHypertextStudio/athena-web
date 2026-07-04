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
 */
import { ArrowRight, Sparkles } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type JSX, type KeyboardEvent, useCallback, useState } from 'react';

import { api } from '@/lib/api';
import { readError, readProblem } from '@/lib/problem';

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
  const [error, setError] = useState<string | null>(null);

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
    try {
      const res = await api.v1.orgs[':orgId'].sessions.$post({
        param: { orgId },
        json: { prompt: text.trim() },
      });
      if (!res.ok) {
        setError(await readProblem(res, 'Athena could not take that on.'));
        setBusy(null);
        return;
      }
      const session = await res.json();
      router.push(`/orgs/${orgId}/sessions/${session.id}`);
    } catch (caught) {
      setError(readError(caught, 'Athena could not take that on.'));
      setBusy(null);
    }
  }, [orgId, text, router]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): void => {
      if (event.key !== 'Enter' || event.shiftKey) return;
      event.preventDefault();
      if (!canSubmit) return;
      if (event.metaKey || event.ctrlKey) void askAthena();
      else void capture();
    },
    [canSubmit, capture, askAthena],
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="border-outline-variant bg-surface-container-low focus-within:ring-ring focus-within:border-ring flex flex-col gap-3 rounded-2xl border p-4 shadow-sm transition-[box-shadow,border-color] duration-(--dur-base) ease-(--ease-out) focus-within:shadow-md focus-within:ring-1 @2xl:p-5">
        <textarea
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            if (notice) setNotice(null);
          }}
          onKeyDown={onKeyDown}
          rows={text.includes('\n') || text.length > 90 ? 3 : 2}
          placeholder="Capture a task, paste a plan, or ask Athena…"
          aria-label="Capture a task or ask Athena"
          disabled={orgId === null}
          className="placeholder:text-on-surface-variant text-on-surface w-full resize-none bg-transparent text-base leading-relaxed outline-none disabled:opacity-50 @2xl:text-lg"
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-on-surface-variant truncate text-sm">
            into <span className="text-on-surface font-medium">{orgLabel}</span>
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
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
