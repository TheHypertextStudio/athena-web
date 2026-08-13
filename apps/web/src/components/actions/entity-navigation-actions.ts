'use client';

/** Baseline navigation actions for core objects whose richer domain actions remain additive. */
import { ArrowRight } from '@docket/ui/icons';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';

import { copyObjectAction } from '@/components/actions/copy-object-action';
import { useCopyOutcome } from '@/components/clipboard';
import {
  type ActionContext,
  defineActionDomain,
  type ObjectKind,
  objectHref,
  useRegisterActionDomain,
} from '@/lib/actions';

/**
 * The first object's detail path, only when it is the expected kind.
 *
 * @remarks
 * Routes through {@link objectHref} rather than building a path here, so a kind's location is
 * derived in exactly one place and an Open never disagrees with a copied link.
 */
function target(context: ActionContext, kind: ObjectKind): string | null {
  const object = context.objects[0];
  if (object?.kind !== kind) return null;
  return objectHref(
    object.organizationId === null && context.organizationId !== null
      ? { ...object, organizationId: context.organizationId }
      : object,
  );
}

/** Register the common Open action for Project, Program, Cycle, and Team objects. */
export function useRegisterEntityNavigationActions(): void {
  const router = useRouter();
  const reportOutcome = useCopyOutcome();
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
            const href = target(context, 'project');
            if (href !== null) router.push(href);
          },
        },
        copyObjectAction('project', reportOutcome),
      ]),
      program: defineActionDomain('program', [
        {
          id: 'program.open',
          label: 'Open program',
          icon: ArrowRight,
          objectKinds: ['program'],
          section: 'primary',
          run: (context) => {
            const href = target(context, 'program');
            if (href !== null) router.push(href);
          },
        },
        copyObjectAction('program', reportOutcome),
      ]),
      cycle: defineActionDomain('cycle', [
        {
          id: 'cycle.open',
          label: 'Open cycle',
          icon: ArrowRight,
          objectKinds: ['cycle'],
          section: 'primary',
          run: (context) => {
            const href = target(context, 'cycle');
            if (href !== null) router.push(href);
          },
        },
        copyObjectAction('cycle', reportOutcome),
      ]),
      team: defineActionDomain('team', [
        {
          id: 'team.open',
          label: 'Open team',
          icon: ArrowRight,
          objectKinds: ['team'],
          section: 'primary',
          run: (context) => {
            const href = target(context, 'team');
            if (href !== null) router.push(href);
          },
        },
        copyObjectAction('team', reportOutcome),
      ]),
    }),
    [router, reportOutcome],
  );

  useRegisterActionDomain('project', domains.project);
  useRegisterActionDomain('program', domains.program);
  useRegisterActionDomain('cycle', domains.cycle);
  useRegisterActionDomain('team', domains.team);
}
