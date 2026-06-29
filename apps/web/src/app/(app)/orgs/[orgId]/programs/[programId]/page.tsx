'use client';

import type { ProgramWorkOut, UpdateOut } from '@docket/types';
import type { PickerOption } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Skeleton } from '@docket/ui/primitives';
import { useParams, useRouter } from 'next/navigation';
import { type JSX, useMemo, useState } from 'react';

import { FlowSnapshot, type FlowMetrics } from '@/components/programs/flow-snapshot';
import { HealthPill, ProgramStatusBadge } from '@/components/programs/program-status';
import { ProgramPropertiesPanel } from '@/components/programs/properties-panel';
import { ProgramTabs, type ProgramTabItem } from '@/components/programs/program-tabs';
import { type ResolveActor, UpdatesPanel } from '@/components/programs/updates-panel';
import { WorkBoard } from '@/components/programs/work-board';
import { memberActorOptions } from '@/components/property-pickers/options';
import { api } from '@/lib/api';
import { apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';
import { useOrgCapability } from '@/lib/use-org-capability';
import { stateTypeOf } from '@/lib/work-state';
import { fetchProgramDetail } from '@/lib/fetch-program-detail';
import { useProgramMutations } from '@/lib/use-program-mutations';

type TabId = 'work' | 'updates';

/** ProgramDetailPage renders the authenticated program page. */
export default function ProgramDetailPage(): JSX.Element {
  const router = useRouter();
  const params = useParams<{ orgId: string; programId: string }>();
  const { orgId, programId } = params;

  const programLabel = useVocabulary('program');
  const projectNoun = useVocabulary('project').toLowerCase();
  const projectsLabel = useVocabulary('project', { plural: true });
  const cycleLabel = useVocabulary('cycle');
  const cyclesLabel = useVocabulary('cycle', { plural: true });
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

  const healthAsOf = updates[0]?.createdAt ?? null;

  if (detailQ.isPending) {
    return (
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 @2xl:p-6 @4xl:p-8">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-4 w-full max-w-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  if (detailQ.isError) {
    return (
      <div className="mx-auto w-full max-w-6xl p-4 @2xl:p-6 @4xl:p-8">
        <p
          role="alert"
          className="border-outline-variant text-destructive text-body rounded-lg border p-4"
        >
          {detailQ.error.message}
        </p>
      </div>
    );
  }

  if (!program) {
    return (
      <div className="mx-auto w-full max-w-6xl p-4 @2xl:p-6 @4xl:p-8">
        <p className="border-outline-variant text-on-surface-variant text-body rounded-xl border border-dashed p-8 text-center">
          This {programLabel.toLowerCase()} could not be found.
        </p>
      </div>
    );
  }

  const health = program.health ?? null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 @2xl:p-6 @4xl:p-8">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-on-surface text-h1">{program.name}</h1>
          <ProgramStatusBadge status={program.status} />
          <HealthPill health={health} />
        </div>
        {program.description ? (
          <p className="text-on-surface-variant text-body max-w-2xl leading-relaxed">
            {program.description}
          </p>
        ) : null}
      </header>

      <div className="grid grid-cols-1 gap-6 @4xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <FlowSnapshot
            health={health}
            healthAsOf={healthAsOf}
            metrics={metrics}
            projectsLabel={projectsLabel}
            cyclesLabel={cyclesLabel}
          />

          <ProgramTabs
            tabs={tabs}
            value={tab}
            onValueChange={(id) => {
              setTab(id as TabId);
            }}
            label={`${programLabel} sections`}
          />

          {tab === 'work' ? (
            <div role="tabpanel" id="tabpanel-work" aria-labelledby="tab-work">
              <WorkBoard
                work={work}
                loading={workQ.isPending}
                error={workQ.isError ? workQ.error.message : null}
                cycleLabel={cycleLabel}
                taskNounPlural={taskNounPlural}
                projectNoun={projectNoun}
                onOpenTask={(taskId) => {
                  router.push(`/orgs/${orgId}/tasks/${taskId}`);
                }}
              />
            </div>
          ) : null}

          {tab === 'updates' ? (
            <div role="tabpanel" id="tabpanel-updates" aria-labelledby="tab-updates">
              <UpdatesPanel
                updates={updates}
                loading={updatesQ.isPending}
                error={updatesQ.isError ? updatesQ.error.message : null}
                resolveActor={resolveActor}
                posting={updatePosting}
                postError={updateError}
                onPost={(body, postHealth) => {
                  postUpdate(body, postHealth);
                }}
              />
            </div>
          ) : null}
        </div>

        <aside className="flex flex-col gap-4">
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
            <p role="alert" className="text-destructive text-body px-1">
              {propsError}
            </p>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
