'use client';

import type { PickerOption } from '@docket/ui/components';
import { useMemo } from 'react';

import type { ActorDirectory } from '@/components/project-detail/actor-directory';
import {
  initiativeOptions as toInitiativeOptions,
  memberActorOptions,
  programOptions as toProgramOptions,
} from '@/components/property-pickers/options';
import { api } from '@/lib/api';
import { projectDetailDef } from '@/lib/fetch-project-detail';
import { apiQueryOptions, queryKeys, useApiQuery } from '@/lib/query';
import { useOrgCapability } from '@/lib/use-org-capability';
import { useProjectMutations } from '@/lib/use-project-mutations';

/** All data, queries, and mutations the project detail page needs. */
export function useProjectDetailPage(orgId: string, projectId: string) {
  const detailKey = queryKeys.project(orgId, projectId);
  const updatesKey = useMemo(() => [...detailKey, 'updates'] as const, [detailKey]);

  const detailQ = useApiQuery(projectDetailDef(orgId, projectId));
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
  const project = detail?.project ?? null;
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
