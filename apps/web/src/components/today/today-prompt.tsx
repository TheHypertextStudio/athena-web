'use client';

/**
 * `today/today-prompt` — the hybrid capture / ask-Athena box at the top of Today.
 *
 * @remarks
 * The single entry point for getting work INTO Docket from the daily surface, wiring the
 * the direct capture path and the one shared personal Athena rail:
 *
 * - **Capture** (`POST /v1/orgs/:orgId/capture`) — the explicit secondary destination. Free text becomes a real
 *   task in the active workspace (its default team's entry state, attached to the live
 *   cycle when one covers today). `Enter` submits.
 * - **Ask Athena** opens the personal rail with this workspace and draft attached. The rail creates
 *   and supervises the work; Today does not grow its own mini session UI.
 *
 * **The two destinations are not a preference, and the box must not pretend otherwise.** Capture is
 * a deterministic insert: `deriveTitle` takes the first non-empty line, truncates it, and puts the
 * rest in the description — no parsing, no decomposition, no agent. Athena spawns a task, an agent,
 * and an approval loop. Hiding which one is armed would be lying about consequences, which is why
 * the destination is named on the control rather than inferred.
 *
 * That is also why the placeholder no longer says "paste a plan". In Task mode a twelve-line
 * braindump becomes *one* task titled by line one; only Athena decomposes it.
 *
 * A line, not a card. The bordered box with a toolbar along its bottom edge made the page's first
 * element a form, and its inner text sat inset from the column every other line on the page aligns
 * to. This shares the page's left edge, so it lines up by construction rather than by a negative
 * margin.
 */
import { ChevronDown, ListChecks, Sparkles } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import Link from '@/components/docket-link';
import { type JSX, type KeyboardEvent, useCallback, useState } from 'react';

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
 * Athena is always the resting destination because this is the day's standing Athena field. Task
 * capture stays available as an explicit secondary destination for the current visit, but never
 * replaces Athena when someone returns to Today.
 */
type CaptureMode = 'task' | 'athena';

/** Props for {@link TodayPrompt}. */
export interface TodayPromptProps {
  /** The active workspace's org id (capture/session target); `null` before resolution. */
  orgId: string | null;
  /** The active workspace's display name (shown so the target is explicit). */
  orgLabel: string;
  /** Invoked after a successful capture so the host can refresh the plan. */
  onCaptured?: (() => void) | undefined;
  /**
   * Expand this page into the Athena conversation, carrying the draft with it.
   *
   * @remarks
   * When the host supplies this, Athena mode stays on the page instead of opening the ⌘J rail, and
   * the draft rides along. Same conversation either way — the rail and the page render the one
   * persistent thread — so this only decides where it appears, not how many there are.
   */
  onStartSession?: ((draft: string) => void) | undefined;
}

/** The hybrid prompt box: capture a task, or hand the thought to Athena. */
export function TodayPrompt({
  orgId,
  orgLabel,
  onCaptured,
  onStartSession,
}: TodayPromptProps): JSX.Element {
  const { openAthena } = useAthenaPanel();
  const [text, setText] = useState('');
  const mentionOrgId = useMentionOrgId(orgId);
  const [busy, setBusy] = useState<'capture' | null>(null);
  const [notice, setNotice] = useState<CaptureNotice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setModeState] = useState<CaptureMode>('athena');

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
    const draft = text.trim();
    setText('');
    // Exactly one surface, never both. A host that shows the conversation itself takes the draft
    // and expands in place; without one, the ⌘J rail is the door. Doing both put the rail on top of
    // the page that had just become the same conversation.
    if (onStartSession) onStartSession(draft);
    else openAthena({ workspaceId: orgId, workspaceName: orgLabel }, draft);
  }, [openAthena, orgId, orgLabel, text, onStartSession]);

  /** Send the draft wherever the active mode points. */
  const submit = useCallback((): void => {
    if (mode === 'athena') askAthena();
    else void capture();
  }, [mode, askAthena, capture]);

  const setMode = useCallback((next: CaptureMode): void => {
    setModeState(next);
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
      <div
        className="border-outline-variant focus-within:border-primary flex flex-col gap-2 border-b pb-2 transition-colors duration-(--dur-base) ease-(--ease-out)"
        style={{ viewTransitionName: 'today-composer' }}
      >
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
          placeholder={mode === 'athena' ? 'Ask Athena about today…' : 'What task needs capturing?'}
          aria-label={mode === 'athena' ? 'Ask Athena about today' : 'Add a task'}
          disabled={orgId === null}
          className="placeholder:text-on-surface-variant text-on-surface w-full resize-none bg-transparent text-base leading-relaxed outline-none disabled:opacity-50 @2xl:text-lg"
        />
        {/* One control, and it says what it will do. The arrow it replaces meant nothing on a
            surface where "send" can mean "insert a row" or "start an agent", and the separate
            destination pill beside it was a second thing to decode before the first made sense.
            The label is the destination; the chevron changes it. */}
        <div className="flex items-center justify-end gap-1">
          <Button
            type="button"
            variant={canSubmit ? 'default' : 'ghost'}
            controlSize="sm"
            disabled={!canSubmit}
            onClick={submit}
            className="min-h-11"
          >
            {mode === 'task' ? <ListChecks /> : <Sparkles />}
            {busy === 'capture' ? 'Adding…' : mode === 'task' ? 'Add task' : 'Ask Athena'}
          </Button>
          <Button
            type="button"
            iconOnly
            variant="ghost"
            controlSize="sm"
            aria-label={`Send to ${modeLabel}. Switch to ${nextMode === 'task' ? 'Add a task' : 'Ask Athena'}.`}
            className="min-h-11 min-w-11"
            onClick={() => {
              setMode(nextMode);
            }}
          >
            <ChevronDown />
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
