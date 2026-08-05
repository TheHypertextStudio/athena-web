'use client';

/**
 * `time-tracking/focus-panel` — the universal timer, as a supplemental rail panel.
 *
 * @remarks
 * The timer used to live in the left sidebar's footer, which is a place for account chrome, and
 * starting it opened a modal that asked for a name before the clock would run. Both were wrong in
 * the same way: they treated tracking as a form to fill in rather than as something a person does
 * while working. Here it sits beside the Agenda and the day plan — the other two panels that
 * answer "what am I doing" — and starting it starts it.
 *
 * Three states share one card so that pausing, resuming and finishing read as the same session
 * changing rather than as different screens arriving. The panel owns no chrome of its own beyond
 * its header, per the rail's convention, and never sets its own width.
 */
import { Text } from '@docket/ui/primitives';
import { type JSX, useId, useState } from 'react';

import { api } from '@/lib/api';
import { userErrorMessage } from '@/lib/problem';
import { STALE, apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';

import FocusIdle, { type FocusShortcut } from './focus-idle';
import FocusSession from './focus-session';
import { useTimerControls, useTimerState } from './use-timer';

/** How many earlier tasks the idle state offers as one-click restarts. */
const SHORTCUT_LIMIT = 4;

/** The current local day as an ISO instant pair, for the timeline read. */
function todayBounds(): { start: string; end: string } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** The Focus rail panel. */
export default function FocusPanel(): JSX.Element {
  const { record, phase, title, unanchored, elapsedMs, suggestion, nudging } = useTimerState();
  const controls = useTimerControls(record?.id ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  const nameFieldId = useId();

  const bounds = todayBounds();
  const timelineQ = useApiQuery(
    apiQueryOptions(
      queryKeys.timeTimeline(`${bounds.start}|${bounds.end}`),
      () => api.v1.time.timeline.$get({ query: bounds }),
      'Could not load today’s time.',
      { staleTime: STALE.volatile },
    ),
  );

  // Real sessions only — the shortcut list is a shortcut back into work that actually happened, so
  // an empty day shows nothing rather than plausible-looking suggestions nobody worked on.
  const shortcuts: FocusShortcut[] = [];
  const seen = new Set<string>();
  for (const item of timelineQ.data?.items ?? []) {
    if (!item.taskId || item.id === record?.id || seen.has(item.taskId)) continue;
    seen.add(item.taskId);
    shortcuts.push({
      taskId: item.taskId,
      title: item.title,
      trackedMs: item.measures.humanEffortMs,
    });
    if (shortcuts.length === SHORTCUT_LIMIT) break;
  }

  const error = timelineQ.isError
    ? userErrorMessage(timelineQ.error, 'Could not load today’s time.')
    : null;

  const start = (taskId?: string): void => {
    setNotice(null);
    void controls.start(taskId ? { taskId } : {}).catch(() => {
      setNotice('Could not start the timer. Try again.');
    });
  };

  return (
    <section aria-label="Focus" className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 px-3 pt-3 pb-2">
        <h2 className="text-on-surface text-title-small">Focus</h2>
        {/* Never the task's name: the card beneath already carries it, and the header repeating
            it cost two lines saying one thing. This line says only what state the timer is in. */}
        <Text token="body-small" tone="muted">
          {phase === 'running'
            ? 'Tracking'
            : phase === 'paused'
              ? 'Paused'
              : nudging && suggestion
                ? 'Your block started'
                : 'Nothing tracking'}
        </Text>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-3 pb-3">
        {record ? (
          <FocusSession
            running={phase === 'running'}
            title={title}
            unanchored={unanchored}
            elapsedMs={elapsedMs}
            // The record's own link back to the block that planned it, written at start. The live
            // suggestion answers a different question and is absent while this session runs.
            fromPlan={record.contexts.some((context) => context.role === 'planning_context')}
            notice={notice}
            controls={controls}
            nameFieldId={nameFieldId}
            onRequestName={() => {
              setNotice('Name this before finishing.');
              document
                .querySelector<HTMLInputElement>(`#${CSS.escape(nameFieldId)} input`)
                ?.focus();
            }}
          />
        ) : (
          <FocusIdle
            suggestion={suggestion}
            nudging={nudging}
            shortcuts={shortcuts}
            starting={controls.starting}
            onStart={start}
          />
        )}

        {/* Degraded rather than replaced: losing today's totals must not take the running clock
            off screen, since that is the one thing this panel exists to keep visible. */}
        {error ? (
          <Text token="body-small" role="status" className="text-on-surface-variant">
            {error}
          </Text>
        ) : null}
      </div>
    </section>
  );
}
