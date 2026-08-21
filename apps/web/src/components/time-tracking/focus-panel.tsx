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

import FocusAthenaHandoff from './focus-athena-handoff';
import FocusIdle from './focus-idle';
import FocusModeLauncher from './focus-mode-launcher';
import FocusSession from './focus-session';
import FocusTaskQueue from './focus-task-queue';
import FocusToday from './focus-today';
import { useFocusToday } from './use-focus-today';
import { type TimerStartInput, useTimerControls, useTimerState } from './use-timer';

/** The Focus rail panel. */
export default function FocusPanel(): JSX.Element {
  const { record, phase, title, unanchored, elapsedMs, suggestion, nudging, loading, error } =
    useTimerState();
  const controls = useTimerControls(record?.id ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  const nameFieldId = useId();
  const today = useFocusToday();

  const start = async (input: TimerStartInput = {}): Promise<void> => {
    setNotice(null);
    try {
      await controls.start(input);
    } catch (error) {
      setNotice('Could not start the timer. Try again.');
      throw error;
    }
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
            shortcuts={[]}
            starting={controls.starting}
            onStart={(taskId) => {
              void start(taskId ? { taskId } : {}).catch(() => undefined);
            }}
          />
        )}

        <FocusTaskQueue
          activeTaskId={record?.taskId ?? null}
          starting={controls.starting}
          onStart={start}
        />

        {notice && !record ? (
          <Text token="body-small" role="status" className="text-on-surface-variant">
            {notice}
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
