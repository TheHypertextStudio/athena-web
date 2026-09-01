import type { CycleBurnupOut, CycleDetail, CycleOut } from '@docket/work/cycle-contract';
import type { MemberOut } from '@docket/identity-access/member-contract';
import type { ProgramOut } from '@docket/work/program-contract';
import type { ProjectOut } from './contracts/project';
import type { RoleOut } from './contracts/role';
import type { TaskOut } from '@docket/work/task-model';

import { type ActorDirectory, buildActorDirectory } from '@/components/agents/actor-directory';
import { api } from './api';
import { type RpcResponse, apiQueryOptions, queryKeys, rpcErrorResponse } from './query';

/** CycleDetailData describes the fetch cycle detail data contract shared by the hook or component. */
export interface CycleDetailData {
  readonly cycle: CycleDetail;
  readonly burnup: CycleBurnupOut | null;
  readonly tasks: readonly TaskOut[];
  readonly projectName: ReadonlyMap<string, string>;
  readonly programName: ReadonlyMap<string, string>;
  readonly otherCycles: readonly CycleOut[];
  readonly members: readonly MemberOut[];
  readonly roles: readonly RoleOut[];
  readonly resolveActor: ActorDirectory['resolve'];
}

/**
 * Read a `projectName` / `programName` lookup back as a real `Map`, whatever shape it arrives in.
 *
 * @remarks
 * Some test fixtures and browser storage adapters cross a JSON boundary. JSON has no `Map`, so
 * these lookups can come back as plain objects. Normalizing on read keeps the declared
 * `ReadonlyMap` shape that the Cycles overview also consumes.
 *
 * @param value - The lookup from a fresh fetch (a `Map`) or a restored cache (a plain record).
 * @returns the lookup as a `Map`; empty when the value is absent or not a lookup at all.
 */
export function asNameMap(value: unknown): ReadonlyMap<string, string> {
  if (value instanceof Map) return value as ReadonlyMap<string, string>;
  if (value && typeof value === 'object') {
    return new Map(
      Object.entries(value).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  }
  return new Map();
}

/**
 * Typed query definition for the cycle detail — the single source the detail page reads with and
 * list rows prefetch on hover, so they share one cache entry under `queryKeys.cycle`.
 *
 * @param orgId - The active org.
 * @param cycleId - The cycle to load.
 * @param fallbackMessage - Shown if the composite read fails (the page passes a vocabulary noun).
 */
export function cycleDetailDef(
  orgId: string,
  cycleId: string,
  fallbackMessage = 'Could not load this cycle.',
) {
  return apiQueryOptions(
    queryKeys.cycle(orgId, cycleId),
    fetchCycleDetail(orgId, cycleId),
    fallbackMessage,
  );
}

/** fetchCycleDetail loads the fetch cycle detail detail data required by the page. */
export function fetchCycleDetail(
  orgId: string,
  cycleId: string,
): () => Promise<RpcResponse<CycleDetailData>> {
  return async () => {
    const [
      cycleRes,
      burnupRes,
      tasksRes,
      projectsRes,
      programsRes,
      membersRes,
      agentsRes,
      cyclesRes,
      rolesRes,
    ] = await Promise.all([
      api.v1.orgs[':orgId'].cycles[':id'].$get({ param: { orgId, id: cycleId } }),
      api.v1.orgs[':orgId'].cycles[':id'].burnup.$get({ param: { orgId, id: cycleId } }),
      api.v1.orgs[':orgId'].cycles[':id'].tasks.$get({ param: { orgId, id: cycleId }, query: {} }),
      api.v1.orgs[':orgId'].projects.$get({ param: { orgId }, query: {} }),
      api.v1.orgs[':orgId'].programs.$get({ param: { orgId }, query: {} }),
      api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
      api.v1.orgs[':orgId'].agents.$get({ param: { orgId } }),
      api.v1.orgs[':orgId'].cycles.$get({ param: { orgId }, query: {} }),
      api.v1.orgs[':orgId'].roles.$get({ param: { orgId } }),
    ]);

    if (!cycleRes.ok) {
      return rpcErrorResponse<CycleDetailData>(cycleRes);
    }

    const cycle = await cycleRes.json();
    const burnup = burnupRes.ok ? await burnupRes.json() : null;
    const tasks: readonly TaskOut[] = tasksRes.ok
      ? (await tasksRes.json()).groups.flatMap((group) => group.tasks)
      : [];

    const projects: readonly ProjectOut[] = projectsRes.ok ? (await projectsRes.json()).items : [];
    const programs: readonly ProgramOut[] = programsRes.ok ? (await programsRes.json()).items : [];
    const memberItems = membersRes.ok ? (await membersRes.json()).items : [];
    const agents = agentsRes.ok ? (await agentsRes.json()).items : [];
    const directory = buildActorDirectory(memberItems, agents);
    const roles = rolesRes.ok ? (await rolesRes.json()).items : [];

    const allCycles: readonly CycleOut[] = cyclesRes.ok ? (await cyclesRes.json()).items : [];
    const otherCycles = allCycles.filter(
      (c) => c.id !== cycleId && c.teamId === cycle.teamId && c.status !== 'completed',
    );

    const data: CycleDetailData = {
      cycle,
      burnup,
      tasks,
      projectName: new Map(projects.map((p) => [p.id, p.name])),
      programName: new Map(programs.map((p) => [p.id, p.name])),
      otherCycles,
      members: memberItems,
      roles,
      resolveActor: directory.resolve,
    };
    return { ok: true, status: cycleRes.status, json: () => Promise.resolve(data) };
  };
}
