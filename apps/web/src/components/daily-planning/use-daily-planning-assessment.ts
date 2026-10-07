'use client';

/** Coalesced model review requests, independent of the manual planning workflow. */
import type { DailyPlanSnapshot } from '@docket/planning/daily-plan-flow';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDailyPlanAssessment } from './daily-planning-assessment-queries';

type Assessment = Awaited<ReturnType<ReturnType<typeof useDailyPlanAssessment>['mutateAsync']>>;
/** An explicit model proposal that can be dismissed or opened in a task composer. */
export type DailyAssessmentSuggestion = Assessment['suggestions'][number];

/** Bind the note to all editable duration, order, timing, and task-selection fields. */
export function dailyAssessmentFingerprint(draft: DailyPlanSnapshot): string {
  let hash = 2166136261;
  for (const character of JSON.stringify(draft))
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `${draft.date}:${hash >>> 0}`;
}

/** Wait for stable edits and run at most one assessment request at a time. */
export function useDailyPlanningAssessment(draft: DailyPlanSnapshot, proposalFingerprint?: string) {
  const token = useMemo(
    () => `${proposalFingerprint ?? ''}:${dailyAssessmentFingerprint(draft)}`,
    [draft, proposalFingerprint],
  );
  const currentToken = useRef(token);
  useEffect(() => {
    currentToken.current = token;
  }, [token]);
  const mounted = useRef(true);
  const requested = useRef<string | null>(null);
  const { mutateAsync } = useDailyPlanAssessment(draft.date);
  const [reply, setReply] = useState<Assessment | null>(null);
  const [pending, setPending] = useState(false);
  const [dismissedNote, setDismissedNote] = useState<string | null>(null);
  const [dismissedTasks, setDismissedTasks] = useState<ReadonlySet<string>>(new Set());
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const requestId = `${token}:${retry}`;
    if (pending || requested.current === requestId) return;
    const timeout = setTimeout(() => {
      requested.current = requestId;
      setPending(true);
      void mutateAsync({ draft, proposalFingerprint: token })
        .then((assessment) => {
          if (mounted.current && currentToken.current === assessment.proposalFingerprint)
            setReply(assessment);
        })
        .catch(() => {
          // Manual review has no dependency on a device or model finishing this request.
        })
        .finally(() => {
          if (mounted.current) setPending(false);
        });
    }, 500);
    return () => {
      clearTimeout(timeout);
    };
  }, [draft, mutateAsync, pending, retry, token]);
  const active = reply?.proposalFingerprint === token ? reply : null;
  return {
    pending,
    note: dismissedNote === token ? null : active?.assessment,
    suggestions:
      active?.suggestions.filter(
        (suggestion) => !dismissedTasks.has(`${token}:${suggestion.projectId}:${suggestion.title}`),
      ) ?? [],
    requestAgain: () => {
      setDismissedNote(null);
      setRetry((value) => value + 1);
    },
    dismissNote: () => {
      setDismissedNote(token);
    },
    dismissTask: (suggestion: DailyAssessmentSuggestion) => {
      setDismissedTasks(
        (previous) =>
          new Set([...previous, `${token}:${suggestion.projectId}:${suggestion.title}`]),
      );
    },
  };
}
