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
import { ArrowRight } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import Link from 'next/link';
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

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): void => {
      if (event.key !== 'Enter' || event.shiftKey) return;
      event.preventDefault();
      if (!canSubmit) return;
      // Enter commits; ⌘/Ctrl+Enter hands the text to Athena instead.
      if (event.metaKey || event.ctrlKey) askAthena();
      else void capture();
    },
    [canSubmit, capture, askAthena],
  );

  return (
    <div className="flex flex-col gap-2">
      {/* No heading and no explainer above the box, on an empty workspace or a full one. What used
          to sit here — a rhetorical "What's on your plate?" over two sentences describing what
          pasting does and promising nothing lands without approval — was the field narrating
          itself. The field has a placeholder, two named buttons, and a target workspace under it;
          a person who can read those does not need the paragraph, and one who cannot is not helped
          by it. Reassurance about approval belongs where approval happens, not here. */}
      <div className="border-outline-variant bg-surface-container-low focus-within:ring-ring focus-within:border-ring flex flex-col gap-3 rounded-2xl border p-4 transition-colors duration-(--dur-base) ease-(--ease-out) focus-within:ring-1 @2xl:p-5">
        <MentionTextarea
          value={text}
          onChange={(next) => {
            setText(next);
            if (notice) setNotice(null);
          }}
          {...(mentionOrgId === undefined ? {} : { orgId: mentionOrgId })}
          insertMode="context"
          onKeyDown={onKeyDown}
          rows={text.includes('\n') || text.length > 90 ? 3 : 2}
          // One placeholder, not two. The empty-workspace variant said "Paste your firehose here —
          // Athena will sort it out…", which named an internal metaphor for the input and then
          // promised an outcome. The buttons below already say what the two outcomes are.
          placeholder="Capture a task, paste a plan, or ask Athena…"
          aria-label="Capture a task or ask Athena"
          disabled={orgId === null}
          className="placeholder:text-on-surface-variant text-on-surface w-full resize-none bg-transparent text-base leading-relaxed outline-none disabled:opacity-50 @2xl:text-lg"
        />
        {/* One action, not a fork. Two peer buttons made every entry a mode choice the person had
            to make before typing was worth anything, on a surface whose whole premise is that you
            write in plain language and the product works out what you meant. Athena is still one
            keystroke away (⌘↵) and one tap away on the global pill; it is not a second submit.

            The "into <workspace>" caption went with them. It labelled a destination nobody chose
            here — on a personal workspace it read "into <your name>'s space", which is noise. */}
        <div className="flex justify-end">
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
