'use client';

import type { PickerOption } from '@docket/ui/components';
import { useMemo } from 'react';

import type { ActorDirectory } from '@/components/project-detail/actor-directory';
import {
  initiativeOptions as toInitiativeOptions,
  memberActorOptions,
  programOptions as toProgramOptions,
} from '@/components/pickers/options';
import { api } from '@/lib/api';
import { projectRecordDef } from '@/lib/entity-records';
import { projectDetailDef } from '@/lib/fetch-project-detail';
import { apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';
import { useOrgCapability } from '@/lib/use-org-capability';
import { useProjectMutations } from '@/lib/use-project-mutations';

/** All data, queries, and mutations the project detail page needs. */
export function useProjectDetailPage(orgId: string, projectId: string) {
  const detailKey = queryKeys.project(orgId, projectId);
  const updatesKey = useMemo(() => [...detailKey, 'updates'] as const, [detailKey]);

  const detailQ = useApiQuery(projectDetailDef(orgId, projectId));
  // The project's own row, read apart from the thirteen-request composite above it. This is what
  // the masthead needs, and it arrives by whichever route is fastest: already in cache from the
  // composer that just created it, warmed by the list the reader came from, or as one cheap read.
  // Without it the page has nothing to show — not even its own name — until the slowest of the
  // composite's requests returns.
  const recordQ = useApiQuery(projectRecordDef(orgId, projectId));
  const updatesQ = useApiQuery(
    apiQueryOptions(
      updatesKey,
      () =>
        api.v1.orgs[':orgId'].updates.$get({
          param: { orgId },
          query: { subjectType: 'project', subjectId: projectId },
        }),
      'Could not load updates.',
    ),
  );
  const resourcesQ = useApiQuery(
    apiQueryOptions(
      [...detailKey, 'resources'] as const,
      () =>
        api.v1.orgs[':orgId'].projects[':id'].resources.$get({
          param: { orgId, id: projectId },
        }),
      'Could not load resources.',
    ),
  );

  const updates = useMemo(() => updatesQ.data?.items ?? [], [updatesQ.data]);
  const resources = useMemo(() => resourcesQ.data?.items ?? [], [resourcesQ.data]);

  const mutations = useProjectMutations(orgId, projectId);

  const detail = detailQ.data ?? null;
  // The row wins while the composite is still in flight; once both are settled they are the same
  // project, and the composite's copy is the one every other slice was derived alongside.
  const project = detail?.project ?? recordQ.data ?? null;
  /**
   * Whether the page still has no identity to render.
   *
   * @remarks
   * The gate the masthead gets, instead of the composite's own pending flag. A page that knows
   * its name, icon and properties should draw them and skeleton only the body it is still
   * waiting on — showing a whole-page placeholder over data already in hand is the thing that
   * made every navigation look slow.
   */
  const identityPending = project === null && (detailQ.isPending || recordQ.isPending);
  const members = detail?.members ?? [];
  const roles = detail?.roles ?? [];
  const programs = detail?.programs ?? [];
  const initiatives = detail?.initiatives ?? [];
  const milestones = detail?.milestones ?? [];
  const milestoneTasks = useMemo(() => detail?.milestoneTasks ?? [], [detail]);
  const resolveActor = useMemo<ActorDirectory>(
    () => detail?.resolveActor ?? (() => ({ name: 'System', kind: 'human' as const })),
    [detail],
  );
  const canEdit = useOrgCapability(members, roles, 'contribute');
  const memberOptions = useMemo<readonly PickerOption[]>(
    () => memberActorOptions(members),
    [members],
  );
  const programOptions = useMemo<readonly PickerOption[]>(
    () => toProgramOptions(programs),
    [programs],
  );
  const initiativeOptions = useMemo<readonly PickerOption[]>(
    () => toInitiativeOptions(initiatives),
    [initiatives],
  );

  const progress = detail?.progress ?? null;
  const agentsHere = detail?.agentsHere ?? [];
  const agentActivity = detail?.agentActivity ?? [];
  const initiativeIds = detail?.initiativeIds ?? [];
  const labels = detail?.labels ?? [];
  const availableLabels = detail?.availableLabels ?? [];

  return {
    detailKey,
    detailQ,
    recordQ,
    identityPending,
    updatesQ,
    resourcesQ,
    detail,
    project,
    updates,
    resources,
    milestones,
    milestoneTasks,
    resolveActor,
    canEdit,
    memberOptions,
    programOptions,
    initiativeOptions,
    progress,
    agentsHere,
    agentActivity,
    initiativeIds,
    labels,
    availableLabels,
    ...mutations,
  };
}
