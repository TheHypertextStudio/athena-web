'use client';

import type { PickerOption } from '@docket/ui/components';
import { ProjectSubjectRef } from '@docket/types';
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
import { useOrgMembership } from '@/lib/use-org-membership';
import { useProjectMutations } from '@/lib/use-project-mutations';

/** All data, queries, and mutations the project detail page needs. */
export function useProjectDetailPage(orgId: string, projectId: string) {
  const subject = ProjectSubjectRef.parse({ subjectType: 'project', subjectId: projectId });
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
          query: subject,
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
  const initiativeDisplaysQ = useApiQuery(
    apiQueryOptions(
      queryKeys.entityDisplays(orgId, 'initiative'),
      () =>
        api.v1.orgs[':orgId'].display[':subjectType'].$get({
          param: { orgId, subjectType: 'initiative' },
        }),
      'Could not load initiative icons.',
    ),
  );

  const updates = useMemo(() => updatesQ.data?.items ?? [], [updatesQ.data]);
  const resources = useMemo(() => resourcesQ.data?.items ?? [], [resourcesQ.data]);

  const mutations = useProjectMutations(orgId, projectId);

  const detail = detailQ.data ?? null;
  // The row wins while the composite is still in flight; once both are settled they are the same
  // project, and the composite's copy is the one every other slice was derived alongside.
  const project = detail?.project ?? recordQ.data ?? null;
  // Capabilities come from the org-wide roster keys rather than the composite, so they resolve
  // on their own fast path. `useOrgCapability` fails closed, which is right for a guest and
  // wrong for a page that is merely still loading — and the two are indistinguishable on screen.
  // Reading them here means the page can wait for the answer instead of rendering the denial.
  const membership = useOrgMembership(orgId);
  const members = detail?.members ?? membership.members;
  const roles = detail?.roles ?? membership.roles;
  /**
   * Whether the page still has nothing it can correctly render.
   *
   * @remarks
   * The gate the masthead gets, instead of the composite's own pending flag. A page that knows
   * its name, icon and properties should draw them and skeleton only the body it is still
   * waiting on — showing a whole-page placeholder over data already in hand is the thing that
   * made every navigation look slow.
   *
   * Capabilities are part of "correctly": rendering identity while they are unknown produces a
   * page whose every control is inert with nothing saying why. Both roster keys are `STALE.static`
   * and shared with every list surface, so arriving from anywhere inside the app they are already
   * warm and this gate costs nothing.
   */
  const identityPending =
    (project === null && (detailQ.isPending || recordQ.isPending)) ||
    (detail === null && membership.pending);
  const programs = detail?.programs ?? [];
  const initiatives = detail?.initiatives ?? [];
  const initiativeDisplays = initiativeDisplaysQ.data?.items ?? [];
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
    () => toInitiativeOptions(initiatives, initiativeDisplays),
    [initiativeDisplays, initiatives],
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
    members,
    roles,
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
