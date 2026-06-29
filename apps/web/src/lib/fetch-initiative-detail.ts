import type { InitiativeDetail, MemberOut, ProgramOut, ProjectOut, RoleOut } from '@docket/types';

import { api } from './api';
import { type RpcResponse, apiQueryOptions, queryKeys } from './query';

/** InitiativeDetailData describes the fetch initiative detail data contract shared by the hook or component. */
export interface InitiativeDetailData {
  readonly detail: InitiativeDetail;
  readonly allProjects: readonly ProjectOut[];
  readonly allPrograms: readonly ProgramOut[];
  readonly members: readonly MemberOut[];
  readonly roles: readonly RoleOut[];
}

/**
 * Typed query definition for the initiative detail — the single source the detail page reads with
 * and list rows prefetch on hover, sharing one cache entry under `queryKeys.initiative`.
 */
export function initiativeDetailDef(
  orgId: string,
  initiativeId: string,
  fallbackMessage = 'Could not load this initiative.',
) {
  return apiQueryOptions(
    queryKeys.initiative(orgId, initiativeId),
    fetchInitiativeDetail(orgId, initiativeId),
    fallbackMessage,
  );
}

/** fetchInitiativeDetail loads the fetch initiative detail detail data required by the page. */
export function fetchInitiativeDetail(
  orgId: string,
  initiativeId: string,
): () => Promise<RpcResponse<InitiativeDetailData>> {
  return async () => {
    const [detailRes, projectsRes, programsRes, membersRes, rolesRes] = await Promise.all([
      api.v1.orgs[':orgId'].initiatives[':id'].$get({ param: { orgId, id: initiativeId } }),
      api.v1.orgs[':orgId'].projects.$get({ param: { orgId } }),
      api.v1.orgs[':orgId'].programs.$get({ param: { orgId } }),
      api.v1.orgs[':orgId'].members.$get({ param: { orgId } }),
      api.v1.orgs[':orgId'].roles.$get({ param: { orgId } }),
    ]);
    if (!detailRes.ok) {
      return {
        ok: false,
        status: detailRes.status,
        json: () => detailRes.json() as unknown as Promise<InitiativeDetailData>,
      };
    }
    const detail = await detailRes.json();
    const allProjects = projectsRes.ok ? (await projectsRes.json()).items : [];
    const allPrograms = programsRes.ok ? (await programsRes.json()).items : [];
    const members = membersRes.ok ? (await membersRes.json()).items : [];
    const roles = rolesRes.ok ? (await rolesRes.json()).items : [];
    return {
      ok: true,
      status: detailRes.status,
      json: () => Promise.resolve({ detail, allProjects, allPrograms, members, roles }),
    };
  };
}
