'use client';

import {
  ActorId,
  type AgentOut,
  type Health,
  type MemberOut,
  type ProgramDetail,
  type ProgramOut,
  type ProgramStatus,
  type ProgramUpdate,
  type ProgramWorkOut,
  type RoleOut,
  type UpdateOut,
  type Visibility,
} from '@docket/types';
import type { PickerOption } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Skeleton } from '@docket/ui/primitives';
import { useParams, useRouter } from 'next/navigation';
import { type JSX, useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { FlowSnapshot, type FlowMetrics } from '@/components/programs/flow-snapshot';
import { HealthPill, ProgramStatusBadge } from '@/components/programs/program-status';
import { ProgramPropertiesPanel } from '@/components/programs/properties-panel';
import { ProgramTabs, type ProgramTabItem } from '@/components/programs/program-tabs';
import { type ResolveActor, UpdatesPanel } from '@/components/programs/updates-panel';
import { WorkBoard } from '@/components/programs/work-board';
import { memberActorOptions } from '@/components/property-pickers/options';
import { api } from '@/lib/api';
import { type RpcResponse, queryKeys, unwrap, useApiMutation, useApiQuery } from '@/lib/query';
import { useOrgCapability } from '@/lib/use-org-capability';
import { stateTypeOf } from '@/lib/work-state';

/** The two top-level tabs of the Program detail screen. */
type TabId = 'work' | 'updates';

/** The composite program-detail payload (the program joined with its naming directories). */
interface ProgramDetailData {
  readonly program: ProgramDetail;
  readonly members: readonly MemberOut[];
  readonly agents: readonly AgentOut[];
  readonly roles: readonly RoleOut[];
}

/** The unbranded properties-panel patch surface. */
interface ProgramPatch {
  ownerId?: string | null;
  status?: ProgramStatus;
  health?: Health | null;
  visibility?: Visibility;
}

/**
 * Build the branded program PATCH body from a {@link ProgramPatch}, omitting untouched fields.
 *
 * @remarks
 * One branded body, reused for the optimistic cache snapshot AND the request. Returns the validated
 * {@link ProgramUpdate} body, whose fields are a subset of {@link ProgramDetail} so it can be spread
 * onto the cached program without widening its branded fields.
 */
function toProgramPatchBody(patch: ProgramPatch): ProgramUpdate {
  return {
    ...(patch.ownerId !== undefined
      ? { ownerId: patch.ownerId === null ? null : ActorId.parse(patch.ownerId) }
      : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.health !== undefined ? { health: patch.health } : {}),
    ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
  };
}

/**
 * Build the composite program-detail fetcher, returning a {@link RpcResponse}-shaped result so it
 * can drive {@link useApiQuery} directly.
 *
 * @remarks
 * Composes the program detail, its members, and its agents in parallel (members + agents build the
 * actor directory that names the owner and update authors). The composite resolves `ok`/`status`
 * from the gating detail read; the directory sub-reads degrade to empty lists.
 */
function fetchProgramDetail(
  orgId: string,
  programId: string,
): () => Promise<RpcResponse<ProgramDetailData>> {
  return async () => {
    const [detailRes, membersRes, agentsRes, rolesRes] = await Promise.all([
      api.v1.orgs[':orgId'].programs[':id'].$get({ param: { orgId, id: programId } }),
      api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
      api.v1.orgs[':orgId'].agents.$get({ param: { orgId } }),
      api.v1.orgs[':orgId'].roles.$get({ param: { orgId } }),
    ]);
    if (!detailRes.ok) {
      return {
        ok: false,
        status: detailRes.status,
        json: () => detailRes.json() as unknown as Promise<ProgramDetailData>,
      };
    }
    const program = await detailRes.json();
    const members = membersRes.ok ? (await membersRes.json()).items : [];
    const agents = agentsRes.ok ? (await agentsRes.json()).items : [];
    const roles = rolesRes.ok ? (await rolesRes.json()).items : [];
    return {
      ok: true,
      status: detailRes.status,
      json: () => Promise.resolve({ program, members, agents, roles }),
    };
  };
}

/**
 * The Program detail view — an ongoing line of work, led by health + flow (§8.4).
 *
 * @remarks
 * A Client Component reached at `/orgs/[orgId]/programs/[programId]`. Programs are *ongoing*
 * operations, so — unlike a Project — there is intentionally NO percent-complete bar. The
 * screen leads with a {@link FlowSnapshot}: the current health verdict and a row of flow
 * metrics (work in flight / queued / done, the cycles the work spans, and the count of
 * projects under the program), rolled up from the work payload. Beneath it, two tabs:
 *
 * - **Work** — the program's work from `…/programs/:id/work`, grouped by *cycle* and
 *   segmented by *project*, rendered faithfully to that nested shape by the
 *   {@link WorkBoard}; rows open the task detail.
 * - **Updates** — the program's status posts from `…/programs/:id/updates`, with a composer
 *   ({@link UpdatesPanel}). Posting a health verdict also moves the program's current
 *   health, so the snapshot refreshes.
 *
 * The detail, work, and updates slices each stay live (auto-refetch on focus) without a manual
 * refresh control; members + agents build the actor directory that names the owner and update
 * authors, and a property edit / update post runs as an optimistic mutation. Entity nouns route
 * through {@link useVocabulary}; data is fetched at runtime so the production build needs no
 * running server.
 */
export default function ProgramDetailPage(): JSX.Element {
  const router = useRouter();
  const params = useParams<{ orgId: string; programId: string }>();
  const { orgId, programId } = params;
  const queryClient = useQueryClient();

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
    detailKey,
    fetchProgramDetail(orgId, programId),
    `Could not load this ${programLabel.toLowerCase()}.`,
  );
  const detail = detailQ.data ?? null;
  const program = detail?.program ?? null;
  const members = detail?.members ?? [];
  const agents = detail?.agents ?? [];
  const roles = detail?.roles ?? [];
  const loading = detailQ.isPending;
  const error = detailQ.isError ? detailQ.error.message : null;

  const workQ = useApiQuery(
    workKey,
    () =>
      api.v1.orgs[':orgId'].programs[':id'].work.$get({
        param: { orgId, id: programId },
        query: {},
      }),
    'Could not load this program’s work.',
  );
  const work: ProgramWorkOut | null = workQ.data ?? null;

  const updatesQ = useApiQuery(
    updatesKey,
    () => api.v1.orgs[':orgId'].programs[':id'].updates.$get({ param: { orgId, id: programId } }),
    'Could not load updates.',
  );
  const updates = useMemo<readonly UpdateOut[]>(() => updatesQ.data?.items ?? [], [updatesQ.data]);

  /** Resolve an actor id to its display name + kind: humans from members, agents tagged. */
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

  /**
   * Roll the work payload into the flow metrics: count tasks by canonical workflow-state
   * type (in flight / queued / done), and count the distinct real cycles + projects the
   * work spans. The program detail's own roll-up supplies the authoritative project count.
   */
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

  /** The most recent update timestamp, to ground the health verdict in time. */
  const healthAsOf = updates[0]?.createdAt ?? null;

  /** Apply a partial change to the cached program, preserving its detail-only roll-up. */
  const patchCachedProgram = useCallback(
    (apply: (program: ProgramDetail) => ProgramDetail): ProgramDetailData | undefined => {
      const previous = queryClient.getQueryData<ProgramDetailData>(detailKey);
      queryClient.setQueryData<ProgramDetailData>(detailKey, (cur) =>
        cur ? { ...cur, program: apply(cur.program) } : cur,
      );
      return previous;
    },
    [queryClient, detailKey],
  );

  /** Post a status update; a health verdict also moves the program's current health. */
  const postUpdateM = useApiMutation({
    mutationFn: ({ body, health }: { body: string; health: Health | undefined }) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].updates.$post({
            param: { orgId },
            json: {
              subjectType: 'program',
              subjectId: programId,
              body,
              ...(health ? { health } : {}),
            },
          }),
        'Could not post your update.',
      ),
    onSuccess: (_created, { health }) => {
      // The newest health becomes the program's current health — reflect it locally.
      if (health) patchCachedProgram((cur) => ({ ...cur, health }));
    },
    invalidateKeys: [updatesKey, detailKey],
  });

  /**
   * Optimistically patch the program (owner / status / health / visibility): apply to the cached
   * payload, fire the PATCH, roll back on failure, and reconcile on settle. A Program PATCH
   * requires `manage`, gated by {@link canEdit}; the picker is disabled while the request is in
   * flight. The PATCH read-back is the base program shape, so success preserves the detail-only
   * roll-up.
   */
  const patch = useApiMutation<ProgramOut, ProgramPatch, { previous?: ProgramDetailData }>({
    mutationFn: (patchBody) =>
      unwrap(
        () =>
          api.v1.orgs[':orgId'].programs[':id'].$patch({
            param: { orgId, id: programId },
            json: toProgramPatchBody(patchBody),
          }),
        `Could not update this ${programLabel.toLowerCase()}.`,
      ),
    onMutate: async (patchBody) => {
      await queryClient.cancelQueries({ queryKey: detailKey });
      const body = toProgramPatchBody(patchBody);
      const previous = patchCachedProgram((cur) => ({ ...cur, ...body }));
      return { previous };
    },
    onError: (_err, _body, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(detailKey, ctx.previous);
    },
    onSuccess: (updated) => {
      patchCachedProgram((cur) => ({ ...cur, ...updated, rollup: cur.rollup }));
    },
    invalidateKeys: [detailKey, queryKeys.programs(orgId)],
  });
  const patchProgram = patch.mutate;
  const propsPending = patch.isPending;
  const propsError = patch.error?.message ?? null;

  // Editing a program requires `manage`; gate the panel's affordances on it.
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

  if (loading) {
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

  if (error) {
    return (
      <div className="mx-auto w-full max-w-6xl p-4 @2xl:p-6 @4xl:p-8">
        <p
          role="alert"
          className="border-outline-variant text-destructive rounded-lg border p-4 text-sm"
        >
          {error}
        </p>
      </div>
    );
  }

  if (!program) {
    return (
      <div className="mx-auto w-full max-w-6xl p-4 @2xl:p-6 @4xl:p-8">
        <p className="border-outline-variant text-on-surface-variant rounded-xl border border-dashed p-8 text-center text-sm">
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
          <h1 className="text-on-surface text-xl font-semibold tracking-tight">{program.name}</h1>
          <ProgramStatusBadge status={program.status} />
          <HealthPill health={health} />
        </div>
        {program.description ? (
          <p className="text-on-surface-variant max-w-2xl text-sm leading-relaxed">
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
                posting={postUpdateM.isPending}
                postError={postUpdateM.error?.message ?? null}
                onPost={(body, postHealth) => {
                  postUpdateM.mutate({ body, health: postHealth });
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
            <p role="alert" className="text-destructive px-1 text-sm">
              {propsError}
            </p>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
