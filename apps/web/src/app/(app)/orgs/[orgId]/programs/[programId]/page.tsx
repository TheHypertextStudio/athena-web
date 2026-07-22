'use client';

import type { ProgramWorkOut, TaskOut, UpdateOut } from '@docket/types';
import { CycleId, TeamId } from '@docket/types';
import type { PickerOption } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Ellipsis, Trash2 } from '@docket/ui/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Skeleton,
} from '@docket/ui/primitives';
import { useParams, useRouter } from 'next/navigation';
import { type JSX, useMemo, useState } from 'react';

import { ConfirmDeleteDialog } from '@/components/confirm-delete-dialog';
import { EditableTitle } from '@/components/editor/editable-title';
import { EditableFreeformText } from '@/components/editor/freeform-text';
import { EntityDocument } from '@/components/editor/entity-document';
import {
  DetailPageLayout,
  PageContainer,
  PageHeader,
  PageHeading,
  PageTitle,
} from '@/components/views/page-layout';
import { type FlowMetrics } from '@/components/programs/flow-snapshot';
import { HealthPill, ProgramStatusBadge } from '@/components/programs/program-status';
import { ProgramPropertiesPanel } from '@/components/programs/properties-panel';
import { ProgramTabs, type ProgramTabItem } from '@/components/programs/program-tabs';
import { type ResolveActor, UpdatesPanel } from '@/components/programs/updates-panel';
import { WorkBoard } from '@/components/programs/work-board';
import { memberActorOptions } from '@/components/property-pickers/options';
import { useActiveOrg } from '@/components/active-org';
import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, unwrap, useApiMutation, useApiQuery } from '@/lib/query';
import { useOrgCapability } from '@/lib/use-org-capability';
import { useRenameTask } from '@/lib/use-rename-task';
import { stateTypeOf } from '@/lib/work-state';
import { fetchProgramDetail } from '@/lib/fetch-program-detail';
import { useProgramMutations } from '@/lib/use-program-mutations';
import { userErrorMessage } from '@/lib/problem';

type TabId = 'work' | 'updates';

/** ProgramDetailPage renders the authenticated program page. */
export default function ProgramDetailPage(): JSX.Element {
  const router = useRouter();
  const params = useParams<{ orgId: string; programId: string }>();
  const { orgId, programId } = params;

  const { defaultTeamId } = useActiveOrg();
  const programLabel = useVocabulary('program');
  const projectNoun = useVocabulary('project').toLowerCase();
  const cycleLabel = useVocabulary('cycle');
  const taskNoun = useVocabulary('task').toLowerCase();
  const taskNounPlural = useVocabulary('task', { plural: true }).toLowerCase();

  const detailKey = queryKeys.program(orgId, programId);
  const workKey = useMemo(() => [...detailKey, 'work'] as const, [detailKey]);
  const updatesKey = useMemo(() => [...detailKey, 'updates'] as const, [detailKey]);

  const [tab, setTab] = useState<TabId>('work');

  const detailQ = useApiQuery(
    apiQueryOptions(
      detailKey,
      fetchProgramDetail(orgId, programId),
      `Could not load this ${programLabel.toLowerCase()}.`,
    ),
  );
  const detail = detailQ.data ?? null;
  const program = detail?.program ?? null;
  const members = detail?.members ?? [];
  const agents = detail?.agents ?? [];
  const roles = detail?.roles ?? [];

  const workQ = useApiQuery(
    apiQueryOptions(
      workKey,
      () =>
        api.v1.orgs[':orgId'].programs[':id'].work.$get({
          param: { orgId, id: programId },
          query: {},
        }),
      "Could not load this program's work.",
    ),
  );
  const work: ProgramWorkOut | null = workQ.data ?? null;

  const updatesQ = useApiQuery(
    apiQueryOptions(
      updatesKey,
      () => api.v1.orgs[':orgId'].programs[':id'].updates.$get({ param: { orgId, id: programId } }),
      'Could not load updates.',
    ),
  );
  const updates = useMemo<readonly UpdateOut[]>(() => updatesQ.data?.items ?? [], [updatesQ.data]);

  const resolveActor = useMemo<ResolveActor>(() => {
    const byId = new Map<string, { name: string; kind: 'human' | 'agent' | 'team' }>();
    for (const member of members)
      byId.set(member.actorId, { name: member.displayName, kind: 'human' });
    for (const agent of agents) {
      const existing = byId.get(agent.actorId);
      byId.set(
        agent.actorId,
        existing ? { ...existing, kind: 'agent' } : { name: 'Agent', kind: 'agent' },
      );
    }
    return (actorId) =>
      actorId
        ? (byId.get(actorId) ?? { name: 'System', kind: 'human' })
        : { name: 'System', kind: 'human' };
  }, [members, agents]);

  const metrics = useMemo<FlowMetrics>(() => {
    let inFlight = 0;
    let queued = 0;
    let done = 0;
    const cycleIds = new Set<string>();
    for (const group of work?.groups ?? []) {
      if (group.cycle.id) cycleIds.add(group.cycle.id);
      for (const segment of group.segments) {
        for (const task of segment.tasks) {
          const type = stateTypeOf(task.state);
          if (type === 'started') inFlight += 1;
          else if (type === 'completed') done += 1;
          else if (type !== 'canceled') queued += 1;
        }
      }
    }
    return {
      inFlight,
      queued,
      done,
      activeCycles: cycleIds.size,
      projects: program?.rollup.projects ?? 0,
    };
  }, [work, program]);

  const { patchProgram, postUpdate, propsPending, propsError, updatePosting, updateError } =
    useProgramMutations(orgId, programId, programLabel, detailKey, updatesKey);

  const canEdit = useOrgCapability(members, roles, 'manage');

  // Rename any task on the board in place, then refresh the cycle-grouped work view.
  const renameWorkTask = useRenameTask(orgId, [workKey]);
  // Inline quick-add: create a task committed to a given cycle from just a typed title. Attaches to
  // the viewer's default team (the board itself is team-agnostic); disabled when there is no team.
  const createWorkTask = useApiMutation<TaskOut, { cycleId: string; title: string }>({
    mutationFn: ({ cycleId, title }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].tasks.$post({
            param: { orgId },
            json: {
              title,
              teamId: TeamId.parse(defaultTeamId ?? ''),
              priority: 'none',
              cycleId: CycleId.parse(cycleId),
            },
          }),
        `Could not add the ${taskNoun}.`,
      ),
    invalidateKeys: [workKey],
  });

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const deleteProgram = useApiMutation({
    mutationFn: () =>
      unwrap(
        () => api.v1.orgs[':orgId'].programs[':id'].$delete({ param: { orgId, id: programId } }),
        `Could not delete this ${programLabel.toLowerCase()}.`,
      ),
    invalidateKeys: [queryKeys.programs(orgId)],
    onSuccess: () => {
      router.push(`/orgs/${orgId}/programs`);
    },
  });

  const memberOptions = useMemo<readonly PickerOption[]>(
    () => memberActorOptions(members),
    [members],
  );

  const tabs: readonly ProgramTabItem[] = useMemo(
    () => [
      { id: 'work', label: 'Work', count: metrics.inFlight + metrics.queued + metrics.done },
      { id: 'updates', label: 'Updates', count: updates.length },
    ],
    [metrics, updates.length],
  );

  if (detailQ.isPending) {
    return (
      <PageContainer>
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-4 w-full max-w-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </PageContainer>
    );
  }

  if (detailQ.isError) {
    return (
      <PageContainer>
        <p role="alert" className="text-destructive text-sm">
          {userErrorMessage(detailQ.error, 'Could not load this program.')}
        </p>
      </PageContainer>
    );
  }

  if (!program) {
    return (
      <PageContainer>
        <p className="bg-surface-container-low text-on-surface-variant text-body-medium rounded-xl p-8 text-center">
          This {programLabel.toLowerCase()} could not be found.
        </p>
      </PageContainer>
    );
  }

  const health = program.health ?? null;

  return (
    <DetailPageLayout
      header={
        <PageHeader>
          <PageHeading>
            <div className="flex flex-wrap items-center gap-3">
              <PageTitle>
                <EditableTitle
                  value={program.name}
                  onSave={(name) => {
                    patchProgram({ name });
                  }}
                  canEdit={canEdit}
                  saving={propsPending}
                  ariaLabel={`${programLabel} name`}
                  className="text-headline-medium text-on-surface font-medium"
                />
              </PageTitle>
              <ProgramStatusBadge status={program.status} />
              <HealthPill health={health} />
            </div>
            <EditableFreeformText
              value={program.summary}
              placeholder="Add a concise summary…"
              canEdit={canEdit}
              saving={propsPending}
              onSave={(summary) => {
                // Optional-not-nullable on the wire: an empty draft clears by sending '' (never null).
                patchProgram({ summary: summary ?? '' });
              }}
              className="text-on-surface-variant text-body-large max-w-4xl font-normal"
            />
          </PageHeading>
          {canEdit ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  aria-label={`${programLabel} actions`}
                >
                  <Ellipsis className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[12rem]">
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => {
                    setConfirmDeleteOpen(true);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete {programLabel.toLowerCase()}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </PageHeader>
      }
      aside={
        <>
          <ProgramPropertiesPanel
            ownerId={program.ownerId ?? null}
            memberOptions={memberOptions}
            status={program.status}
            health={health}
            visibility={program.visibility}
            canEdit={canEdit}
            pending={propsPending}
            onOwnerChange={(ownerId) => {
              patchProgram({ ownerId });
            }}
            onStatusChange={(status) => {
              patchProgram({ status });
            }}
            onHealthChange={(next) => {
              patchProgram({ health: next });
            }}
            onVisibilityChange={(visibility) => {
              patchProgram({ visibility });
            }}
          />
          {propsError ? (
            <p role="alert" className="text-destructive text-body-medium px-1">
              {propsError}
            </p>
          ) : null}
        </>
      }
    >
      <EntityDocument
        value={program.description}
        canEdit={canEdit}
        saving={propsPending}
        onSave={(description) => {
          patchProgram({ description });
        }}
        placeholder={`Add the ${programLabel} brief…`}
      />

      {/* Work sections: the tab bar sits above the divider, its panel below. */}
      <div className="border-outline-variant -mb-2 border-b pb-2">
        <ProgramTabs
          tabs={tabs}
          value={tab}
          onValueChange={(id) => {
            setTab(id as TabId);
          }}
          label={`${programLabel} sections`}
        />
      </div>

      {tab === 'work' ? (
        <div role="tabpanel" id="tabpanel-work" aria-labelledby="tab-work">
          <WorkBoard
            work={work}
            loading={workQ.isPending}
            error={
              workQ.isError ? userErrorMessage(workQ.error, 'Could not load this program.') : null
            }
            cycleLabel={cycleLabel}
            taskNoun={taskNoun}
            taskNounPlural={taskNounPlural}
            projectNoun={projectNoun}
            canEdit={canEdit}
            onOpenTask={(taskId) => {
              router.push(`/orgs/${orgId}/tasks/${taskId}`);
            }}
            onRename={renameWorkTask}
            {...(defaultTeamId
              ? {
                  onAddTask: (cycleId: string, title: string) =>
                    createWorkTask.mutateAsync({ cycleId, title }).then(() => undefined),
                }
              : {})}
          />
        </div>
      ) : null}

      {tab === 'updates' ? (
        <div role="tabpanel" id="tabpanel-updates" aria-labelledby="tab-updates">
          <UpdatesPanel
            updates={updates}
            loading={updatesQ.isPending}
            error={
              updatesQ.isError
                ? userErrorMessage(updatesQ.error, 'Could not load this program.')
                : null
            }
            resolveActor={resolveActor}
            posting={updatePosting}
            postError={updateError}
            onPost={(body, postHealth) => {
              postUpdate(body, postHealth);
            }}
          />
        </div>
      ) : null}

      <ConfirmDeleteDialog
        open={confirmDeleteOpen}
        onOpenChange={(next) => {
          // Clear any prior failure so a stale message never shows on reopen.
          deleteProgram.reset();
          setConfirmDeleteOpen(next);
        }}
        title={`Delete this ${programLabel.toLowerCase()}?`}
        description={`This permanently removes "${program.name}" and unlinks its projects and work. This can't be undone.`}
        error={
          deleteProgram.error
            ? userErrorMessage(
                deleteProgram.error,
                `Could not delete this ${programLabel.toLowerCase()}.`,
              )
            : null
        }
        confirmLabel={`Delete ${programLabel.toLowerCase()}`}
        pending={deleteProgram.isPending}
        onConfirm={() => {
          deleteProgram.mutate(undefined, {
            onSuccess: () => {
              setConfirmDeleteOpen(false);
            },
          });
        }}
      />
    </DetailPageLayout>
  );
}
