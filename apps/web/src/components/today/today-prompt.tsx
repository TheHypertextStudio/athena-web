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
 * One box, one visible action, one behaviour at every moment. It carries no heading, no
 * explanatory paragraph, no destination caption, and no empty-workspace variant — all of which it
 * used to, and all of which were the field describing itself to the person already using it.
 * Enter captures; ⌘/Ctrl+Enter hands the same text to Athena instead, which is also what the
 * global Athena pill does.
 */
import { ArrowUp, CornerDownLeft, ListChecks, Sparkles } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import { readStoredString, writeStoredValue } from '@docket/ui/lib/browser-storage';
import Link from 'next/link';
import { type JSX, type KeyboardEvent, useCallback, useEffect, useState } from 'react';

import { useAthenaPanel } from '@/components/athena/athena-panel-provider';
import { useMentionOrgId } from '@/components/mentions/use-mention-org';
import { api } from '@/lib/api';
import { userErrorMessage, readProblemError } from '@/lib/problem';
import MentionTextarea from '@/components/mentions/mention-textarea';

/** A successful capture: enough to confirm AND point at the created task. */
interface CaptureNotice {
  /** The created task's title (echoed so the confirmation feels concrete). */
  title: string;
  /** Where the task lives, for the follow-the-work link. */
  href: string;
}

/**
 * Where this box sends what you typed.
 *
 * @remarks
 * A persisted setting, not a per-submit choice. The two peer buttons this replaced made every
 * entry a mode decision before typing was worth anything, on the surface whose premise is that you
 * write plainly and the product works out the rest. You pick a destination once and it stays.
 */
type CaptureMode = 'task' | 'athena';

/** Where the chosen destination survives a reload. */
const CAPTURE_MODE_KEY = 'docket.today.capture-mode';

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
  const mentionOrgId = useMentionOrgId(orgId);
  const [busy, setBusy] = useState<'capture' | null>(null);
  const [notice, setNotice] = useState<CaptureNotice | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Read on mount, never in the initializer: this renders on the server, and an initializer that
  // returned the stored mode on the client and the default on the server leaves the DOM stuck on
  // whatever the server emitted. See `@docket/ui/lib/browser-storage`.
  const [mode, setModeState] = useState<CaptureMode>('task');
  useEffect(() => {
    if (readStoredString(CAPTURE_MODE_KEY) === 'athena') setModeState('athena');
  }, []);

  // No empty-workspace fork. This box used to run a `tasks` probe purely to decide whether to
  // show an onboarding heading, a different placeholder, swapped button emphasis, and a different
  // Enter target — four behaviours diverging on a network read, so the same keystroke did
  // different things depending on a count the person typing could not see. One box, one
  // behaviour, one fewer request.
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

  /** Send the draft wherever the active mode points. */
  const submit = useCallback((): void => {
    if (mode === 'athena') askAthena();
    else void capture();
  }, [mode, askAthena, capture]);

  const setMode = useCallback((next: CaptureMode): void => {
    setModeState(next);
    writeStoredValue(CAPTURE_MODE_KEY, next);
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): void => {
      if (event.key !== 'Enter' || event.shiftKey) return;
      event.preventDefault();
      if (!canSubmit) return;
      // Enter sends in the active mode. ⌘/Ctrl+Enter sends too, and is the chord to rely on: while
      // the `@` menu is open `MentionTextarea` swallows a plain Enter to pick a mention and lets
      // only this one through (see `mention-textarea.tsx`).
      submit();
    },
    [canSubmit, submit],
  );

  const nextMode: CaptureMode = mode === 'task' ? 'athena' : 'task';
  const modeLabel = mode === 'task' ? 'Task' : 'Athena';

  return (
    <div className="flex flex-col gap-2">
      {/* No heading and no explainer above the box. What used to sit here — a rhetorical
          "What's on your plate?" over two sentences describing what pasting does — was the field
          narrating itself to the person already using it. */}
      <div className="border-outline-variant bg-surface-container-low focus-within:ring-ring focus-within:border-ring flex flex-col gap-2 rounded-2xl border p-3 transition-colors duration-(--dur-base) ease-(--ease-out) focus-within:ring-2 @2xl:p-4">
        <MentionTextarea
          value={text}
          onChange={(next) => {
            setText(next);
            if (notice) setNotice(null);
          }}
          {...(mentionOrgId === undefined ? {} : { orgId: mentionOrgId })}
          insertMode="context"
          onKeyDown={onKeyDown}
          // Measured, not guessed. This was `rows={text.length > 90 ? 3 : 2}` — a stand-in for
          // "has it wrapped yet" that is wrong at every width it was not tuned for.
          rows={1}
          autoGrow
          maxRows={10}
          placeholder="Capture a task, paste a plan, or ask Athena…"
          aria-label="Capture a task or ask Athena"
          disabled={orgId === null}
          className="placeholder:text-on-surface-variant text-on-surface w-full resize-none bg-transparent px-1 pt-1 text-base leading-relaxed outline-none disabled:opacity-50 @2xl:text-lg"
        />
        {/* The bottom row: destination on the left, send on the right. One send, because a field
            with two peer submit buttons makes every entry a mode decision before typing is worth
            anything. The destination is a setting you flip and it stays, which is what lets the
            send button be a bare arrow — the mode pill is already saying where the text goes. */}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            controlSize="xs"
            className="rounded-full"
            aria-pressed={mode === 'athena'}
            title={`Sending to ${modeLabel}. Switch to ${nextMode === 'task' ? 'Task' : 'Athena'}.`}
            onClick={() => {
              setMode(nextMode);
            }}
          >
            {mode === 'task' ? <ListChecks /> : <Sparkles />}
            {modeLabel}
          </Button>
          <span className="text-on-surface-variant text-label-small ml-auto hidden items-center gap-1 @lg:flex">
            <CornerDownLeft aria-hidden="true" className="size-3.5" />
            to send
          </span>
          {/* Filled only once there is something to send. A permanently filled button meant the
              resting state of an empty field was a loud control for an action that was not yet
              available. `rounded-full` overrides the primitive's `rounded-md`; it is the one
              circular control in the app and it earns that by being the composer's single action. */}
          <Button
            type="button"
            iconOnly
            controlSize="md"
            variant={canSubmit ? 'default' : 'ghost'}
            className="ml-auto rounded-full @lg:ml-0"
            disabled={!canSubmit}
            aria-label={busy === 'capture' ? 'Adding…' : `Send to ${modeLabel}`}
            onClick={submit}
          >
            <ArrowUp />
          </Button>
        </div>
      </div>
      <div aria-live="polite" className="min-h-4 px-1">
        {error ? (
          <p className="text-error text-sm">{error}</p>
        ) : notice ? (
          <p className="text-on-surface-variant text-sm">
            Added <span className="text-on-surface font-medium">“{notice.title}”</span> —{' '}
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
