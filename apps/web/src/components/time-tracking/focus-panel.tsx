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
import { Skeleton, Text } from '@docket/ui/primitives';
import { type JSX, useId, useState } from 'react';

import FocusIdle, { type FocusShortcut } from './focus-idle';
import FocusAthenaHandoff from './focus-athena-handoff';
import FocusModeLauncher from './focus-mode-launcher';
import FocusSession from './focus-session';
import FocusTaskContext from './focus-task-context';
import FocusToday from './focus-today';
import { useFocusTask } from './use-focus-task';
import { useFocusToday } from './use-focus-today';
import { useTimerControls, useTimerState } from './use-timer';

/** How many earlier tasks the idle state offers as one-click restarts. */
const SHORTCUT_LIMIT = 4;

/** The Focus rail panel. */
export default function FocusPanel(): JSX.Element {
  const { record, phase, title, unanchored, elapsedMs, suggestion, nudging, loading, error } =
    useTimerState();
  const controls = useTimerControls(record?.id ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  const nameFieldId = useId();
  const taskContext = useFocusTask(record?.organizationId ?? null, record?.taskId ?? null);
  const today = useFocusToday();

  // Real sessions only — the shortcut list is a shortcut back into work that actually happened, so
  // an empty day shows nothing rather than plausible-looking suggestions nobody worked on.
  const shortcuts: FocusShortcut[] = [];
  const seen = new Set<string>();
  for (const item of today.records) {
    if (!item.taskId || item.id === record?.id || seen.has(item.taskId)) continue;
    seen.add(item.taskId);
    shortcuts.push({
      taskId: item.taskId,
      title: item.title,
      trackedMs: item.measures.humanEffortMs,
    });
    if (shortcuts.length === SHORTCUT_LIMIT) break;
  }

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
          {loading
            ? 'Loading timer'
            : error
              ? 'Timer unavailable'
              : phase === 'running'
                ? 'Tracking'
                : phase === 'paused'
                  ? 'Paused'
                  : nudging && suggestion
                    ? 'Your block started'
                    : 'Nothing tracking'}
        </Text>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-3 pb-3">
        {loading ? (
          <div
            data-testid="timer-loading"
            className="flex flex-col gap-2"
            aria-label="Loading timer"
          >
            <Skeleton className="h-28 w-full rounded-xl" />
          </div>
        ) : error ? (
          <Text token="body-small" role="alert" className="text-error">
            {error}
          </Text>
        ) : record ? (
          <FocusSession
            running={phase === 'running'}
            title={title}
            unanchored={unanchored}
            organizationId={record.organizationId}
            taskId={record.taskId}
            elapsedMs={elapsedMs}
            // The record's own link back to the block that planned it, written at start. The live
            // suggestion answers a different question and is absent while this session runs.
            fromPlan={record.contexts.some((context) => context.role === 'planning_context')}
            notice={notice}
            onNotice={setNotice}
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

        {taskContext.isPending ? (
          <div aria-label="Loading task context" className="flex flex-col gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : taskContext.task ? (
          <>
            <FocusTaskContext
              task={taskContext.task}
              workflowState={taskContext.workflowState}
              workflowStates={taskContext.workflowStates}
            />
            {taskContext.error ? (
              <Text token="body-small" role="status" className="text-on-surface-variant">
                {taskContext.error}
              </Text>
            ) : null}
          </>
        ) : taskContext.error ? (
          <Text token="body-small" role="status" className="text-on-surface-variant">
            {taskContext.error}
          </Text>
        ) : null}

        <FocusToday records={today.records} activeRecordId={record?.id ?? null} />

        <FocusAthenaHandoff />

        {/* Degraded rather than replaced: losing today's totals must not take the running clock
            off screen, since that is the one thing this panel exists to keep visible. */}
        {today.error ? (
          <Text token="body-small" role="status" className="text-on-surface-variant">
            {today.error}
          </Text>
        ) : null}
      </div>
      <FocusModeLauncher />
    </section>
  );
}
