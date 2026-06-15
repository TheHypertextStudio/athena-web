import type {
  CycleBurnupOut,
  CycleDetail,
  CycleOut,
  MemberOut,
  ProgramOut,
  ProjectOut,
  RoleOut,
  TaskOut,
} from '@docket/types';

import { type ActorDirectory, buildActorDirectory } from '@/components/agents/actor-directory';
import { api } from './api';
import type { RpcResponse } from './query';

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
      api.v1.orgs[':orgId'].projects.$get({ param: { orgId } }),
      api.v1.orgs[':orgId'].programs.$get({ param: { orgId } }),
      api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
      api.v1.orgs[':orgId'].agents.$get({ param: { orgId } }),
      api.v1.orgs[':orgId'].cycles.$get({ param: { orgId } }),
      api.v1.orgs[':orgId'].roles.$get({ param: { orgId } }),
    ]);

    if (!cycleRes.ok) {
      return {
        ok: false,
        status: cycleRes.status,
        json: () => cycleRes.json() as unknown as Promise<CycleDetailData>,
      };
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
