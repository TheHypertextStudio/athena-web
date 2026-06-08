'use client';

import {
  ActorId,
  type AgentOut,
  type Health,
  type MemberOut,
  type ProgramDetail,
  type ProgramStatus,
  type ProgramWorkOut,
  type RoleOut,
  type UpdateOut,
  type Visibility,
} from '@docket/types';
import type { PickerOption } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { Skeleton } from '@docket/ui/primitives';
import { useParams, useRouter } from 'next/navigation';
import { type JSX, useCallback, useEffect, useMemo, useState } from 'react';

import { FlowSnapshot, type FlowMetrics } from '@/components/programs/flow-snapshot';
import { HealthPill, ProgramStatusBadge } from '@/components/programs/program-status';
import { ProgramPropertiesPanel } from '@/components/programs/properties-panel';
import { ProgramTabs, type ProgramTabItem } from '@/components/programs/program-tabs';
import { type ResolveActor, UpdatesPanel } from '@/components/programs/updates-panel';
import { WorkBoard } from '@/components/programs/work-board';
import { memberActorOptions } from '@/components/property-pickers/options';
import { api } from '@/lib/api';
import { readError, readProblem } from '@/lib/problem';
import { useOrgCapability } from '@/lib/use-org-capability';
import { stateTypeOf } from '@/lib/work-state';

/** The two top-level tabs of the Program detail screen. */
type TabId = 'work' | 'updates';

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
 * It composes the detail, work, updates, members, and agents slices in parallel; members +
 * agents build the actor directory that names the owner and update authors. Entity nouns
 * route through {@link useVocabulary}; data is fetched at runtime so the production build
 * needs no running server.
 */
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

  const [program, setProgram] = useState<ProgramDetail | null>(null);
  const [work, setWork] = useState<ProgramWorkOut | null>(null);
  const [members, setMembers] = useState<readonly MemberOut[]>([]);
  const [agents, setAgents] = useState<readonly AgentOut[]>([]);
  const [roles, setRoles] = useState<readonly RoleOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Properties-panel mutation state (optimistic PATCH + rollback).
  const [propsPending, setPropsPending] = useState(false);
  const [propsError, setPropsError] = useState<string | null>(null);

  const [workLoading, setWorkLoading] = useState(true);
  const [workError, setWorkError] = useState<string | null>(null);

  const [updates, setUpdates] = useState<readonly UpdateOut[]>([]);
  const [updatesLoading, setUpdatesLoading] = useState(true);
  const [updatesError, setUpdatesError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  const [tab, setTab] = useState<TabId>('work');

  /** Load the program detail, its members, and its agents (for owner + author names). */
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [detailRes, membersRes, agentsRes, rolesRes] = await Promise.all([
        api.v1.orgs[':orgId'].programs[':id'].$get({ param: { orgId, id: programId } }),
        api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
        api.v1.orgs[':orgId'].agents.$get({ param: { orgId } }),
        api.v1.orgs[':orgId'].roles.$get({ param: { orgId } }),
      ]);
      if (!detailRes.ok) {
        setError(
          await readProblem(detailRes, `Could not load this ${programLabel.toLowerCase()}.`),
        );
        return;
      }
      setProgram(await detailRes.json());
      if (membersRes.ok) setMembers((await membersRes.json()).items);
      if (agentsRes.ok) setAgents((await agentsRes.json()).items);
      if (rolesRes.ok) setRoles((await rolesRes.json()).items);
    } catch (caught) {
      setError(
        readError(caught, `Something went wrong loading this ${programLabel.toLowerCase()}.`),
      );
    } finally {
      setLoading(false);
    }
  }, [orgId, programId, programLabel]);

  /** Load the program's work (cycle-grouped, project-segmented). */
  const loadWork = useCallback(async (): Promise<void> => {
    setWorkLoading(true);
    setWorkError(null);
    try {
      const res = await api.v1.orgs[':orgId'].programs[':id'].work.$get({
        param: { orgId, id: programId },
        query: {},
      });
      if (!res.ok) {
        setWorkError(await readProblem(res, 'Could not load this program’s work.'));
        return;
      }
      setWork(await res.json());
    } catch (caught) {
      setWorkError(readError(caught, 'Something went wrong loading this program’s work.'));
    } finally {
      setWorkLoading(false);
    }
  }, [orgId, programId]);

  /** Load the program's status updates. */
  const loadUpdates = useCallback(async (): Promise<void> => {
    setUpdatesLoading(true);
    setUpdatesError(null);
    try {
      const res = await api.v1.orgs[':orgId'].programs[':id'].updates.$get({
        param: { orgId, id: programId },
      });
      if (!res.ok) {
        setUpdatesError(await readProblem(res, 'Could not load updates.'));
        return;
      }
      setUpdates((await res.json()).items);
    } catch (caught) {
      setUpdatesError(readError(caught, 'Something went wrong loading updates.'));
    } finally {
      setUpdatesLoading(false);
    }
  }, [orgId, programId]);

  useEffect(() => {
    void load();
    void loadWork();
    void loadUpdates();
  }, [load, loadWork, loadUpdates]);

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

  /** Post a status update; a health verdict also moves the program's current health. */
  const postUpdate = useCallback(
    async (body: string, health: Health | undefined): Promise<void> => {
      setPosting(true);
      setPostError(null);
      try {
        const res = await api.v1.orgs[':orgId'].updates.$post({
          param: { orgId },
          json: {
            subjectType: 'program',
            subjectId: programId,
            body,
            ...(health ? { health } : {}),
          },
        });
        if (!res.ok) {
          setPostError(await readProblem(res, 'Could not post your update.'));
          return;
        }
        const created = await res.json();
        setUpdates((current) => [created, ...current]);
        // The newest health becomes the program's current health — reflect it locally.
        if (health) setProgram((current) => (current ? { ...current, health } : current));
      } catch (caught) {
        setPostError(readError(caught, 'Something went wrong posting your update.'));
      } finally {
        setPosting(false);
      }
    },
    [orgId, programId],
  );

  /**
   * Optimistically patch the program (owner / status / health / visibility): apply locally,
   * fire the PATCH, and roll back to the prior snapshot on failure. A Program PATCH requires
   * `manage`, gated by {@link canEdit}; the picker is disabled while the request is in flight.
   */
  const patchProgram = useCallback(
    async (patch: {
      ownerId?: string | null;
      status?: ProgramStatus;
      health?: Health | null;
      visibility?: Visibility;
    }): Promise<void> => {
      if (!program) return;
      const previous = program;
      const body = {
        ...(patch.ownerId !== undefined
          ? { ownerId: patch.ownerId === null ? null : ActorId.parse(patch.ownerId) }
          : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.health !== undefined ? { health: patch.health } : {}),
        ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
      };
      setProgram({ ...program, ...body });
      setPropsPending(true);
      setPropsError(null);
      try {
        const res = await api.v1.orgs[':orgId'].programs[':id'].$patch({
          param: { orgId, id: programId },
          json: body,
        });
        if (!res.ok) {
          setProgram(previous);
          setPropsError(
            await readProblem(res, `Could not update this ${programLabel.toLowerCase()}.`),
          );
          return;
        }
        // The PATCH read-back is the base program shape; preserve the detail-only roll-up.
        const updated = await res.json();
        setProgram((current) =>
          current ? { ...current, ...updated, rollup: current.rollup } : current,
        );
      } catch (caught) {
        setProgram(previous);
        setPropsError(
          readError(caught, `Something went wrong updating this ${programLabel.toLowerCase()}.`),
        );
      } finally {
        setPropsPending(false);
      }
    },
    [program, orgId, programId, programLabel],
  );

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
                loading={workLoading}
                error={workError}
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
                loading={updatesLoading}
                error={updatesError}
                resolveActor={resolveActor}
                posting={posting}
                postError={postError}
                onPost={(body, postHealth) => {
                  void postUpdate(body, postHealth);
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
              void patchProgram({ ownerId });
            }}
            onStatusChange={(status) => {
              void patchProgram({ status });
            }}
            onHealthChange={(next) => {
              void patchProgram({ health: next });
            }}
            onVisibilityChange={(visibility) => {
              void patchProgram({ visibility });
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
