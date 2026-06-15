import type { AgentOut, MemberOut, ProgramDetail, RoleOut } from '@docket/types';

import { api } from './api';
import type { RpcResponse } from './query';

/** ProgramDetailData describes the fetch program detail data contract shared by the hook or component. */
export interface ProgramDetailData {
  readonly program: ProgramDetail;
  readonly members: readonly MemberOut[];
  readonly agents: readonly AgentOut[];
  readonly roles: readonly RoleOut[];
}

/** fetchProgramDetail loads the fetch program detail detail data required by the page. */
export function fetchProgramDetail(
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
