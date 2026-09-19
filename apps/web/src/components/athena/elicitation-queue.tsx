'use client';

/**
 * The questions Athena is waiting on, as entries in the conversation where she asked them.
 *
 * @remarks
 * A question exists to unblock work you are already looking at, so it lives in the thread at the
 * time it was asked rather than in a band of its own. This module owns what the thread does not:
 *
 * - **Presence.** While the thread is mounted and the tab is focused, the server knows you are
 *   reachable, which is what makes a new question live rather than a notification.
 * - **Liveness.** A short live poll, so a question raised by work in the background appears without
 *   a refresh.
 * - **Landing.** `?elicitation=<id>` (the path a notification's body-click lands on) names the
 *   question to ring and scroll to, so arriving from a banner puts you on the question.
 */
import type { ElicitationOut } from '@docket/athena/elicitation-api';
import { type JSX, useEffect, useMemo, useState } from 'react';

import { ElicitationCard } from './elicitation-card';
import { useAthenaPresence, useLiveElicitations } from './elicitation-data';
import { EnableNotificationsPrompt } from './elicitation-notifications';

/** How many recently settled questions stay in the thread as records. */
const SETTLED_KEPT = 3;

/**
 * The workspace one question's own task lives in, read off its link.
 *
 * @remarks
 * A file answer is stored as an attachment on that task, so the upload has to target the task's
 * workspace — not whichever workspace the surrounding surface happens to be showing. Reading it
 * from the server-rendered link keeps the two in step by construction.
 */
export function workspaceOfQuestion(elicitation: ElicitationOut): string | null {
  return /^\/orgs\/([^/]+)\//.exec(elicitation.task.href)?.[1] ?? null;
}

/** What the thread needs to render its questions. */
export interface ThreadQuestions {
  /** Pending questions and the few most recently settled, for this workspace. */
  readonly questions: readonly ElicitationOut[];
  /** The question a notification landed on, to ring and scroll to. */
  readonly landingId: string | null;
}

/**
 * Read the caller's questions for one workspace, live, and keep the caller present while mounted.
 *
 * @param workspaceId - Questions whose task lives in another workspace stay out of this thread.
 * @param enabled - Exactly one mounted thread should own presence and the live read.
 */
export function useThreadQuestions(workspaceId: string, enabled: boolean): ThreadQuestions {
  const { pending, settled } = useLiveElicitations(enabled);
  const [landingId, setLandingId] = useState<string | null>(null);

  useAthenaPresence(enabled);

  // Read from `location` rather than `useSearchParams`: the thread is mounted inside surfaces that
  // are not otherwise client-navigation-aware, and `useSearchParams` requires a Suspense boundary
  // in the App Router and throws outright without a router. Landing is a one-shot read on mount.
  useEffect(() => {
    if (!enabled) return;
    setLandingId(new URLSearchParams(window.location.search).get('elicitation'));
  }, [enabled]);

  const questions = useMemo(() => {
    if (!enabled) return [];
    const inWorkspace = (question: ElicitationOut): boolean => {
      const owner = workspaceOfQuestion(question);
      return owner === null || owner === workspaceId;
    };
    return [...pending, ...settled.slice(0, SETTLED_KEPT)].filter(inWorkspace);
  }, [enabled, pending, settled, workspaceId]);

  return { questions, landingId };
}

/** Props for {@link ThreadQuestion}. */
export interface ThreadQuestionProps {
  readonly question: ElicitationOut;
  /** The workspace the surrounding thread belongs to, for a question whose task names none. */
  readonly workspaceId: string;
  /** Whether a notification landed on this question. */
  readonly focused: boolean;
}

/** One question as a thread entry, with the notification offer when the question is urgent. */
export function ThreadQuestion({
  question,
  workspaceId,
  focused,
}: ThreadQuestionProps): JSX.Element {
  const urgent = question.status === 'pending' && question.timeSensitive;
  return (
    <div className="flex w-full max-w-160 flex-col gap-2">
      {urgent ? <EnableNotificationsPrompt relevant /> : null}
      <ElicitationCard
        elicitation={question}
        organizationId={workspaceOfQuestion(question) ?? workspaceId}
        focused={focused}
      />
    </div>
  );
}
