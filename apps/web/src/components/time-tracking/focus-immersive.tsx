'use client';

/** The chrome-free, task-dominant immersive Focus composition. */
import { ChevronLeft, OpenInNew } from '@docket/ui/icons';
import { Button, Separator, Skeleton, Text } from '@docket/ui/primitives';
import Link from '@/components/docket-link';
import { LoadFailure } from '@/components/feedback';
import { useAppRouter as useRouter } from '@/lib/interactions/navigation';
import { type JSX, useId, useState } from 'react';

import FocusIdle, { type FocusShortcut } from './focus-idle';
import FocusRouteFrame from './focus-route-frame';
import FocusSession from './focus-session';
import FocusTaskContext from './focus-task-context';
import FocusToday from './focus-today';
import FocusDayContext from './focus-day-context';
import { returnFromFocus } from './focus-window';
import { useFocusTask } from './use-focus-task';
import { useFocusToday } from './use-focus-today';
import { useTimerControls, useTimerState } from './use-timer';

/** How many real earlier tasks are offered as quick restarts while idle. */
const IMMERSIVE_SHORTCUT_LIMIT = 4;

/** Props for {@link FocusImmersive}. */
export interface FocusImmersiveProps {
  /** The authenticated person whose density preference scopes this page. */
  readonly userId?: string | null | undefined;
}

function focusShortcuts(
  records: ReturnType<typeof useFocusToday>['records'],
  activeRecordId: string | undefined,
): FocusShortcut[] {
  const shortcuts: FocusShortcut[] = [];
  const seen = new Set<string>();
  for (const item of records) {
    if (!item.taskId || item.id === activeRecordId || seen.has(item.taskId)) continue;
    seen.add(item.taskId);
    shortcuts.push({
      taskId: item.taskId,
      title: item.title,
      trackedMs: item.measures.humanEffortMs,
    });
    if (shortcuts.length === IMMERSIVE_SHORTCUT_LIMIT) break;
  }

  return shortcuts;
}

function ImmersiveSession({
  timer,
  controls,
  notice,
  onNotice,
  nameFieldId,
}: {
  readonly timer: ReturnType<typeof useTimerState>;
  readonly controls: ReturnType<typeof useTimerControls>;
  readonly notice: string | null;
  readonly onNotice: (notice: string | null) => void;
  readonly nameFieldId: string;
}): JSX.Element | null {
  if (!timer.record) return null;
  return (
    <div className="relative min-w-0 md:col-start-2 md:row-start-1 md:pl-8">
      <Separator orientation="vertical" className="absolute inset-y-0 left-0 hidden md:block" />
      <FocusSession
        running={timer.phase === 'running'}
        title={timer.title}
        unanchored={timer.unanchored}
        organizationId={timer.record.organizationId}
        taskId={timer.record.taskId}
        elapsedMs={timer.elapsedMs}
        fromPlan={timer.record.contexts.some((context) => context.role === 'planning_context')}
        notice={notice}
        onNotice={onNotice}
        controls={controls}
        nameFieldId={nameFieldId}
        onRequestName={() => {
          onNotice('Name this before finishing.');
          document.querySelector<HTMLInputElement>(`#${CSS.escape(nameFieldId)} input`)?.focus();
        }}
        presentation="page"
      />
    </div>
  );
}

/** Immersive Focus mode, sharing all work state and controls with the rail companion. */
export default function FocusImmersive({ userId = null }: FocusImmersiveProps): JSX.Element {
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

  const shortcuts = focusShortcuts(today.records, timer.record?.id);

  const start = (taskId?: string): void => {
    setNotice(null);
    // A rejected start is presented as a notice by the timer's own mutation.
    void controls.start(taskId ? { taskId } : {}).catch(() => undefined);
  };

  return (
    <FocusRouteFrame
      userId={userId}
      navigation={
        <Button
          variant="ghost"
          controlSize="md"
          iconOnly
          aria-label="Return to workspace"
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
        </Button>
      }
      title={
        <Text as="h1" token="title-small" className="truncate">
          Focus mode
        </Text>
      }
      actions={
        <Text token="body-small" tone="muted" className="shrink-0">
          {timer.phase === 'running' ? 'Tracking' : timer.phase === 'paused' ? 'Paused' : 'Ready'}
        </Text>
      }
    >
      <div className="mx-auto grid w-full max-w-[1440px] grid-cols-1 gap-6 px-4 py-5 sm:px-6 md:grid-cols-[minmax(0,1fr)_22rem] md:grid-rows-[auto_1fr] md:px-10 md:py-8 lg:gap-12 lg:px-16">
        <ImmersiveSession
          timer={timer}
          controls={controls}
          notice={notice}
          onNotice={setNotice}
          nameFieldId={nameFieldId}
        />
        <section
          aria-label="Focused work"
          className="min-w-0 py-2 md:col-start-1 md:row-span-2 md:row-start-1 md:pr-4"
        >
          {timer.loading ? (
            <div className="flex max-w-2xl flex-col gap-4">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-36 w-full" />
            </div>
          ) : timer.error ? (
            <LoadFailure
              title="Your timer"
              error={timer.failure}
              onRetry={timer.reload}
              retrying={timer.reloading}
            />
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
                  project={taskContext.project}
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
                presentation="page"
              />
            </div>
          )}
          {taskContext.error ? (
            <Text token="body-small" role="status" className="text-on-surface-variant mt-4">
              {taskContext.error}
            </Text>
          ) : null}
        </section>

        <aside
          className={`relative flex min-w-0 flex-col gap-5 pt-6 md:col-start-2 md:pt-0 md:pl-8 ${timer.record ? 'md:row-start-2' : 'md:row-start-1'}`}
        >
          <Separator className="absolute inset-x-0 top-0 md:hidden" />
          <Separator orientation="vertical" className="absolute inset-y-0 left-0 hidden md:block" />
          <FocusToday
            records={today.records}
            activeRecordId={timer.record?.id ?? null}
            presentation="page"
          />
          <FocusDayContext taskId={timer.record?.taskId ?? null} />
          {today.error ? (
            <Text token="body-small" role="status" tone="muted">
              {today.error}
            </Text>
          ) : null}
        </aside>
      </div>
    </FocusRouteFrame>
  );
}
