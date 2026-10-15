'use client';
import { useState, type JSX } from 'react';
import type { WorkTemplateOut } from '@docket/work/work-template-contract';
import type { WorkScheduleCreate, WorkScheduleOut } from '@docket/work/work-schedule-management';
import { Button, Surface } from '@docket/ui/primitives';
import { ConfirmDestructiveDialog, InlineBanner } from '@docket/ui/components';
import { Plus, RefreshCw } from '@docket/ui/icons';
import { useApiQuery, useInfiniteApiQuery } from '@/lib/query';
import { userErrorMessage } from '@/lib/problem';
import { workTemplatesDef } from '@/components/templates/work-template-queries';
import { ScheduleEditor } from './schedule-editor';
import { ScheduleHistory } from './schedule-history';
import { ScheduleCard } from './schedule-card';
import { ScheduleRunDialog } from './schedule-run-dialog';
import { useWorkScheduleWrites, workSchedulesDef } from './work-schedule-queries';

interface ProgramSchedulesProps {
  readonly orgId: string;
  readonly programId: string;
  readonly programName: string;
  readonly canEdit: boolean;
  readonly enabled?: boolean;
}
/** Program-owned recurring work, with definition, lifecycle and recovery in one stable section. */
export function ProgramSchedules({
  orgId,
  programId,
  programName,
  canEdit,
  enabled = true,
}: ProgramSchedulesProps): JSX.Element {
  const schedules = useInfiniteApiQuery({ ...workSchedulesDef(orgId, programId), enabled });
  const templates = useApiQuery({ ...workTemplatesDef(orgId, { includeArchived: true }), enabled });
  const state = useProgramScheduleState(orgId);
  const { setEditor, failure } = state;
  const items = schedules.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <ScheduleSectionHeader
        canAdd={canEdit && items.length > 0}
        onNew={() => {
          setEditor('new');
        }}
      />
      {failure ? (
        <InlineBanner tone="critical" title="Schedule was not changed">
          {failure}
        </InlineBanner>
      ) : null}
      <ScheduleLoadingState
        pending={schedules.isPending}
        failed={schedules.isError}
        empty={items.length === 0}
        canEdit={canEdit}
        onNew={() => {
          setEditor('new');
        }}
        onRetry={() => void schedules.refetch()}
      />
      <ScheduleCollection
        orgId={orgId}
        items={items}
        templates={templates.data?.items ?? []}
        state={state}
      />
      {schedules.hasNextPage ? (
        <Button
          variant="secondary"
          className="self-start"
          disabled={schedules.isFetchingNextPage}
          onClick={() => void schedules.fetchNextPage()}
        >
          {schedules.isFetchingNextPage ? 'Loading…' : 'More schedules'}
        </Button>
      ) : null}
      <ScheduleDialogs
        orgId={orgId}
        programId={programId}
        programName={programName}
        state={state}
      />
    </div>
  );
}

function useProgramScheduleState(orgId: string) {
  const writes = useWorkScheduleWrites(orgId);
  const [editor, setEditor] = useState<WorkScheduleOut | 'new' | null>(null);
  const [history, setHistory] = useState<WorkScheduleOut | null>(null);
  const [ending, setEnding] = useState<WorkScheduleOut | null>(null);
  const [running, setRunning] = useState<WorkScheduleOut | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const lifecycle = async (
    schedule: WorkScheduleOut,
    action: 'pause' | 'resume' | 'end',
  ): Promise<void> => {
    if (action === 'end') {
      setEnding(schedule);
      return;
    }
    setFailure(null);
    try {
      await writes.lifecycle.mutateAsync({ id: schedule.id, action });
    } catch (error) {
      setFailure(userErrorMessage(error, 'Could not change this schedule. Try again.'));
    }
  };
  const save = async (input: WorkScheduleCreate): Promise<void> => {
    if (editor && editor !== 'new') {
      const { ownerProgramId: _owner, ...revision } = input;
      await writes.revise.mutateAsync({
        ...revision,
        id: editor.id,
        expectedRevisionId: editor.revision.id,
      });
    } else await writes.create.mutateAsync(input);
  };
  return {
    writes,
    editor,
    setEditor,
    history,
    setHistory,
    ending,
    setEnding,
    running,
    setRunning,
    failure,
    setFailure,
    lifecycle,
    save,
  };
}
function ScheduleDialogs({
  orgId,
  programId,
  programName,
  state,
}: {
  readonly orgId: string;
  readonly programId: string;
  readonly programName: string;
  readonly state: ReturnType<typeof useProgramScheduleState>;
}): JSX.Element {
  const { editor, setEditor, history, setHistory, running, setRunning, save } = state;
  return (
    <>
      {editor ? (
        <ScheduleEditor
          key={editor === 'new' ? 'new' : editor.id}
          orgId={orgId}
          programId={programId}
          programName={programName}
          schedule={editor === 'new' ? undefined : editor}
          open
          onOpenChange={(value) => {
            if (!value) setEditor(null);
          }}
          onSubmit={save}
        />
      ) : null}
      {history ? (
        <ScheduleHistory
          orgId={orgId}
          schedule={history}
          open
          onOpenChange={(value) => {
            if (!value) setHistory(null);
          }}
        />
      ) : null}
      {running ? (
        <ScheduleRunDialog
          orgId={orgId}
          schedule={running}
          onClose={() => {
            setRunning(null);
          }}
        />
      ) : null}
      <ScheduleEndConfirmation state={state} />
    </>
  );
}
function ScheduleLoadingState({
  pending,
  failed,
  empty,
  canEdit,
  onNew,
  onRetry,
}: {
  readonly pending: boolean;
  readonly failed: boolean;
  readonly empty: boolean;
  readonly canEdit: boolean;
  readonly onNew: () => void;
  readonly onRetry: () => void;
}): JSX.Element {
  return (
    <>
      {failed ? (
        <InlineBanner tone="critical" title="Could not load all schedules">
          <Button variant="ghost" onClick={onRetry}>
            Try again
          </Button>
        </InlineBanner>
      ) : null}
      {pending ? (
        <Surface tone="card" shape="large" className="p-6">
          <p role="status">Loading schedules…</p>
        </Surface>
      ) : null}
      {!pending && !failed && empty ? (
        <Surface
          tone="card"
          shape="large"
          className="grid min-w-0 gap-6 p-6 sm:grid-cols-[auto_minmax(0,1fr)] sm:p-8"
        >
          <Surface
            tone="prominent"
            shape="large"
            className="flex size-16 items-center justify-center"
          >
            <RefreshCw className="size-8" aria-hidden="true" />
          </Surface>
          <div className="flex min-w-0 flex-col items-start gap-3">
            <h3 className="text-headline-small">Make room for the work that returns</h3>
            <p className="text-body-large text-on-surface-variant max-w-lg">
              A monthly community dinner, a weekly check-in or preparation after the last project
              finishes. Choose the work once, then give it a rhythm.
            </p>
            {canEdit ? (
              <Button onClick={onNew}>
                <Plus className="size-4" />
                Add a schedule
              </Button>
            ) : (
              <p className="text-body-medium text-on-surface-variant">
                Someone who manages this Program can add a schedule.
              </p>
            )}
          </div>
        </Surface>
      ) : null}
    </>
  );
}

function ScheduleSectionHeader({
  canAdd,
  onNew,
}: {
  readonly canAdd: boolean;
  readonly onNew: () => void;
}): JSX.Element {
  return (
    <header className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2">
      <h2 className="text-title-large">Recurring work</h2>
      {canAdd ? (
        <Button onClick={onNew}>
          <Plus className="size-4" />
          Add schedule
        </Button>
      ) : null}
    </header>
  );
}

function ScheduleEndConfirmation({
  state,
}: {
  readonly state: ReturnType<typeof useProgramScheduleState>;
}): JSX.Element {
  const { ending, setEnding, writes, setFailure } = state;
  return (
    <ConfirmDestructiveDialog
      open={ending !== null}
      onOpenChange={(value) => {
        if (!value && !writes.lifecycle.isPending) setEnding(null);
      }}
      title="End this schedule?"
      description={`Future runs of ${ending?.name ?? 'this schedule'} will stop permanently. Existing work and run history are kept. Pause it instead if you may want to resume.`}
      confirmLabel="End schedule"
      pending={writes.lifecycle.isPending}
      onConfirm={() => {
        if (!ending) return;
        setFailure(null);
        void writes.lifecycle
          .mutateAsync({ id: ending.id, action: 'end' })
          .then(() => {
            setEnding(null);
          })
          .catch((error: unknown) => {
            setFailure(userErrorMessage(error, 'Could not end this schedule. Try again.'));
          });
      }}
    />
  );
}

function ScheduleCollection({
  orgId,
  items,
  templates,
  state,
}: {
  readonly orgId: string;
  readonly items: readonly WorkScheduleOut[];
  readonly templates: readonly WorkTemplateOut[];
  readonly state: ReturnType<typeof useProgramScheduleState>;
}): JSX.Element {
  const { writes, setEditor, setHistory, setRunning, lifecycle } = state;
  return (
    <div className="grid min-w-0 gap-4">
      {items.map((schedule) => (
        <ScheduleCard
          key={schedule.id}
          orgId={orgId}
          schedule={schedule}
          template={templates.find(
            (item) =>
              item.id ===
              (schedule.revision.document?.kind === 'schedule'
                ? schedule.revision.document.template.workTypeId
                : null),
          )}
          pending={writes.lifecycle.isPending}
          onEdit={() => {
            setEditor(schedule);
          }}
          onHistory={() => {
            setHistory(schedule);
          }}
          onLifecycle={(action) => void lifecycle(schedule, action)}
          onRun={() => {
            setRunning(schedule);
          }}
        />
      ))}
    </div>
  );
}
