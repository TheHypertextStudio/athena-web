'use client';

/** Baseline navigation actions for core objects whose richer domain actions remain additive. */
import { ArrowRight } from '@docket/ui/icons';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';

import {
  type ActionContext,
  defineActionDomain,
  type ObjectKind,
  useRegisterActionDomain,
} from '@/lib/actions';

/** Return the first id only when the context contains the expected kind and workspace. */
function target(context: ActionContext, kind: ObjectKind): { orgId: string; id: string } | null {
  const object = context.objects[0];
  return object?.kind === kind && context.organizationId !== null
    ? { orgId: context.organizationId, id: object.id }
    : null;
}

/** Register the common Open action for Project, Program, Cycle, and Team objects. */
export function useRegisterEntityNavigationActions(): void {
  const router = useRouter();
  const domains = useMemo(
    () => ({
      project: defineActionDomain('project', [
        {
          id: 'project.open',
          label: 'Open project',
          icon: ArrowRight,
          objectKinds: ['project'],
          section: 'primary',
          run: (context) => {
            const value = target(context, 'project');
            if (value) router.push(`/orgs/${value.orgId}/projects/${value.id}`);
          },
        },
      ]),
      program: defineActionDomain('program', [
        {
          id: 'program.open',
          label: 'Open program',
          icon: ArrowRight,
          objectKinds: ['program'],
          section: 'primary',
          run: (context) => {
            const value = target(context, 'program');
            if (value) router.push(`/orgs/${value.orgId}/programs/${value.id}`);
          },
        },
      ]),
      cycle: defineActionDomain('cycle', [
        {
          id: 'cycle.open',
          label: 'Open cycle',
          icon: ArrowRight,
          objectKinds: ['cycle'],
          section: 'primary',
          run: (context) => {
            const value = target(context, 'cycle');
            if (value) router.push(`/orgs/${value.orgId}/cycles/${value.id}`);
          },
        },
      ]),
      team: defineActionDomain('team', [
        {
          id: 'team.open',
          label: 'Open team',
          icon: ArrowRight,
          objectKinds: ['team'],
          section: 'primary',
          run: (context) => {
            const value = target(context, 'team');
            if (value) router.push(`/orgs/${value.orgId}/teams/${value.id}`);
          },
        },
      ]),
    }),
    [router],
  );

  useRegisterActionDomain('project', domains.project);
  useRegisterActionDomain('program', domains.program);
  useRegisterActionDomain('cycle', domains.cycle);
  useRegisterActionDomain('team', domains.team);
}
