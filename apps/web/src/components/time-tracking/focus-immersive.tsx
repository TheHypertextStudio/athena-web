'use client';

/** The chrome-free, task-dominant immersive Focus composition. */
import { ChevronLeft, OpenInNew } from '@docket/ui/icons';
import { Button, Skeleton, Text } from '@docket/ui/primitives';
import Link from 'next/link';
import { useAppRouter as useRouter } from '@/lib/interactions/navigation';
import { type JSX, useId, useState } from 'react';

import FocusIdle, { type FocusShortcut } from './focus-idle';
import FocusSession from './focus-session';
import FocusTaskContext from './focus-task-context';
import FocusToday from './focus-today';
import { returnFromFocus } from './focus-window';
import { useFocusTask } from './use-focus-task';
import { useFocusToday } from './use-focus-today';
import { useTimerControls, useTimerState } from './use-timer';

/** How many real earlier tasks are offered as quick restarts while idle. */
const IMMERSIVE_SHORTCUT_LIMIT = 4;

/** Immersive Focus mode, sharing all work state and controls with the rail companion. */
export default function FocusImmersive(): JSX.Element {
  const router = useRouter();
  const timer = useTimerState();
  const controls = useTimerControls(timer.record?.id ?? null);
  const taskContext = useFocusTask(
    timer.record?.organizationId ?? null,
    timer.record?.taskId ?? null,
  );
  const today = useFocusToday();
  const [notice, setNotice] = useState<string | null>(null);
  const nameFieldId = useId();

  const shortcuts: FocusShortcut[] = [];
  const seen = new Set<string>();
  for (const item of today.records) {
    if (!item.taskId || item.id === timer.record?.id || seen.has(item.taskId)) continue;
    seen.add(item.taskId);
    shortcuts.push({
      taskId: item.taskId,
      title: item.title,
      trackedMs: item.measures.humanEffortMs,
    });
    if (shortcuts.length === IMMERSIVE_SHORTCUT_LIMIT) break;
  }

  const start = (taskId?: string): void => {
    setNotice(null);
    void controls.start(taskId ? { taskId } : {}).catch(() => {
      setNotice('Could not start the timer. Try again.');
    });
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[1440px] flex-col">
      <header className="border-outline-variant/50 flex min-h-16 items-center justify-between gap-4 border-b px-4 sm:px-6">
        <Button
          variant="ghost"
          controlSize="xl"
          onClick={() => {
            returnFromFocus({
              popout: new URLSearchParams(window.location.search).get('mode') === 'popout',
              opener: window.opener as { closed: boolean; focus: () => void } | null,
              close: () => {
                window.close();
              },
              navigate: (href) => {
                router.push(href);
              },
              returnPath: new URLSearchParams(window.location.search).get('returnTo'),
              origin: window.location.origin,
            });
          }}
        >
          <ChevronLeft aria-hidden="true" />
          Return to workspace
        </Button>
        <h1 className="text-on-surface text-title-medium hidden sm:block">Focus mode</h1>
        <Text token="body-small" tone="muted" className="shrink-0">
          {timer.phase === 'running' ? 'Tracking' : timer.phase === 'paused' ? 'Paused' : 'Ready'}
        </Text>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-8 px-5 py-8 md:grid-cols-[minmax(0,1fr)_22rem] md:px-10 lg:gap-12 lg:px-16">
        <section aria-label="Focused work" className="min-w-0 py-2 md:pr-4">
          {timer.loading ? (
            <div className="flex max-w-2xl flex-col gap-4">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-36 w-full" />
            </div>
          ) : timer.error ? (
            <div className="flex max-w-xl flex-col gap-2">
              <Text token="headline-large">Your timer is temporarily unavailable.</Text>
              <Text token="body-large" role="alert" className="text-error">
                {timer.error}
              </Text>
            </div>
          ) : timer.record?.taskId && timer.record.organizationId ? (
            <div className="flex max-w-3xl flex-col gap-6">
              <Link
                href={`/orgs/${timer.record.organizationId}/tasks/${timer.record.taskId}`}
                className="group focus-visible:outline-primary rounded-md focus-visible:outline-2 focus-visible:outline-offset-4"
              >
                <span className="text-on-surface text-display-small group-hover:text-primary inline text-balance">
                  {timer.title}
                </span>{' '}
                <OpenInNew
                  aria-hidden="true"
                  className="text-on-surface-variant inline size-5 align-baseline"
                />
              </Link>
              {taskContext.isPending ? (
                <div data-testid="focus-task-loading" className="flex flex-col gap-3">
                  <Skeleton className="h-5 w-48" />
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-32 w-full" />
                </div>
              ) : taskContext.task ? (
                <FocusTaskContext
                  task={taskContext.task}
                  workflowState={taskContext.workflowState}
                  workflowStates={taskContext.workflowStates}
                  expanded
                />
              ) : null}
            </div>
          ) : timer.record ? (
            <div className="flex max-w-2xl flex-col gap-3">
              <Text token="headline-large">Stay with the work in front of you.</Text>
              <Text token="body-large" tone="muted">
                Name this session when the task becomes clear. The timer is already running.
              </Text>
            </div>
          ) : (
            <div className="flex max-w-xl flex-col gap-6">
              <div className="flex flex-col gap-2">
                <Text token="headline-large">Ready for the next thing.</Text>
                <Text token="body-large" tone="muted">
                  Start from what your day suggests, or begin without naming it yet.
                </Text>
              </div>
              <FocusIdle
                suggestion={timer.suggestion}
                nudging={timer.nudging}
                shortcuts={shortcuts}
                starting={controls.starting}
                onStart={start}
                comfortable
              />
            </div>
          )}
          {taskContext.error ? (
            <Text token="body-small" role="status" className="text-on-surface-variant mt-4">
              {taskContext.error}
            </Text>
          ) : null}
        </section>

        <aside className="border-outline-variant/40 flex min-w-0 flex-col gap-5 border-t pt-6 md:border-t-0 md:border-l md:pt-0 md:pl-8">
          {timer.record ? (
            <FocusSession
              running={timer.phase === 'running'}
              title={timer.title}
              unanchored={timer.unanchored}
              organizationId={timer.record.organizationId}
              taskId={timer.record.taskId}
              elapsedMs={timer.elapsedMs}
              fromPlan={timer.record.contexts.some(
                (context) => context.role === 'planning_context',
              )}
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
              comfortable
            />
          ) : null}
          <FocusToday
            records={today.records}
            activeRecordId={timer.record?.id ?? null}
            comfortable
          />
          {today.error ? (
            <Text token="body-small" role="status" tone="muted">
              {today.error}
            </Text>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
