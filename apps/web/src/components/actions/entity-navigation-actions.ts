'use client';

/** Baseline navigation actions for core objects whose richer domain actions remain additive. */
import { ArrowRight, Flag, Layers, Tag, User, Users, Workflow } from '@docket/ui/icons';
import { ProgramUpdate, ProjectUpdate } from '@docket/types';
import type { RelationEndpoint } from '@docket/work/relation-contract';
import { useQueryClient } from '@tanstack/react-query';
import { useAppRouter as useRouter } from '@/lib/interactions/navigation';
import { useMemo } from 'react';

import { copyObjectAction } from '@/components/actions/copy-object-action';
import { useCopyOutcome } from '@/components/clipboard';
import { usePickerOverlay } from '@/components/pickers/picker-overlay';
import {
  createProjectRelationCommandPort,
  type ProjectRelationId,
} from '@/components/projects/project-relation-port';
import {
  createProgramRelationCommandPort,
  type ProgramRelationId,
} from '@/components/programs/program-relation-port';
import {
  type ActionContext,
  defineActionDomain,
  type ObjectKind,
  objectHref,
  useRegisterActionDomain,
} from '@/lib/actions';
import { api } from '@/lib/api';
import { UserFacingError } from '@/lib/problem';
import { queryKeys, unwrap } from '@/lib/query';

const PROJECT_RELATION_RESPONSIVENESS = {
  // The shared relation adapter owns painted and spoken feedback for these commands.
  ownership: 'autonomous',
} as const;

const PROGRAM_RELATION_RESPONSIVENESS = {
  ownership: 'autonomous',
} as const;

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
  const queryClient = useQueryClient();
  const pickerOverlay = usePickerOverlay();
  const reportOutcome = useCopyOutcome();
  const domains = useMemo(() => {
    const duplicateAsNoOp = async (
      write: () => Promise<unknown>,
    ): Promise<'applied' | 'unchanged'> => {
      try {
        await write();
        return 'applied';
      } catch (error) {
        if (error instanceof UserFacingError && error.status === 409) return 'unchanged';
        throw error;
      }
    };
    const refreshProject = (organizationId: string, projectId: string): void => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.project(organizationId, projectId),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects(organizationId) });
    };
    const projectPort = createProjectRelationCommandPort({
      patchProject: async (organizationId, projectId, patch) => {
        await unwrap(
          () =>
            api.v1.orgs[':orgId'].projects[':id'].$patch({
              param: { orgId: organizationId, id: projectId },
              json: ProjectUpdate.parse(patch),
            }),
          'Could not change the project relationship.',
        );
        refreshProject(organizationId, projectId);
      },
      linkInitiative: (organizationId, projectId, initiativeId) =>
        duplicateAsNoOp(() =>
          unwrap(
            () =>
              api.v1.orgs[':orgId'].initiatives[':id'].projects.$post({
                param: { orgId: organizationId, id: initiativeId },
                json: { projectId },
              }),
            'Could not link the project to the initiative.',
          ),
        ),
      addLabel: async (organizationId, projectId, labelId) => {
        await unwrap(
          () =>
            api.v1.orgs[':orgId'].projects[':id'].labels.$post({
              param: { orgId: organizationId, id: projectId },
              json: { labelId },
            }),
          'Could not add the project label.',
        );
        refreshProject(organizationId, projectId);
        return 'applied';
      },
      addDependency: (organizationId, blockingProjectId, blockedProjectId) =>
        duplicateAsNoOp(() =>
          unwrap(
            () =>
              api.v1.orgs[':orgId'].projects[':id'].dependencies.$post({
                param: { orgId: organizationId, id: blockingProjectId },
                json: { blockedProjectId },
              }),
            'Could not create the project dependency.',
          ),
        ),
    });
    const programPort = createProgramRelationCommandPort({
      setOwner: async (organizationId, programId, ownerId) => {
        await unwrap(
          () =>
            api.v1.orgs[':orgId'].programs[':id'].$patch({
              param: { orgId: organizationId, id: programId },
              json: ProgramUpdate.parse({ ownerId }),
            }),
          'Could not set the program owner.',
        );
        void queryClient.invalidateQueries({ queryKey: queryKeys.programs(organizationId) });
      },
      linkInitiative: (organizationId, programId, initiativeId) =>
        duplicateAsNoOp(() =>
          unwrap(
            () =>
              api.v1.orgs[':orgId'].initiatives[':id'].programs.$post({
                param: { orgId: organizationId, id: initiativeId },
                json: { programId },
              }),
            'Could not link the program to the initiative.',
          ),
        ),
      addLabel: (organizationId, programId, labelId) =>
        duplicateAsNoOp(() =>
          unwrap(
            () =>
              api.v1.orgs[':orgId'].programs[':id'].labels.$post({
                param: { orgId: organizationId, id: programId },
                json: { labelId },
              }),
            'Could not add the program label.',
          ),
        ),
    });
    const subjects = <TKind extends 'project' | 'program'>(
      context: ActionContext,
      kind: TKind,
    ): readonly (RelationEndpoint & { readonly kind: TKind })[] =>
      context.objects.flatMap((object) =>
        object.kind === kind
          ? [
              {
                kind,
                id: object.id,
                organizationId: object.organizationId,
                ...(object.meta ? { meta: object.meta } : {}),
              },
            ]
          : [],
      );
    const executeProject = async (
      context: ActionContext,
      relationId: ProjectRelationId,
    ): Promise<void> => {
      if (context.target === undefined) {
        if (context.organizationId !== null) {
          pickerOverlay.open({
            kind: 'relation-target',
            relationId,
            organizationId: context.organizationId,
            subjects: context.objects,
          });
        }
        return;
      }
      await projectPort.execute({
        relationId,
        effect:
          relationId === 'project.program' ||
          relationId === 'project.team' ||
          relationId === 'project.lead'
            ? 'move'
            : 'link',
        subjects: subjects(context, 'project'),
        target: {
          kind:
            context.target.kind === 'calendar_event'
              ? 'calendar_item'
              : (context.target.kind as RelationEndpoint['kind']),
          id: context.target.id,
          organizationId: context.target.organizationId,
          ...(context.target.meta ? { meta: context.target.meta } : {}),
        },
      });
    };
    const executeProgram = async (
      context: ActionContext,
      relationId: ProgramRelationId,
    ): Promise<void> => {
      if (context.target === undefined) {
        if (context.organizationId !== null) {
          pickerOverlay.open({
            kind: 'relation-target',
            relationId,
            organizationId: context.organizationId,
            subjects: context.objects,
          });
        }
        return;
      }
      await programPort.execute({
        relationId,
        effect: relationId === 'program.owner' ? 'move' : 'link',
        subjects: subjects(context, 'program'),
        target: {
          kind: context.target.kind as RelationEndpoint['kind'],
          id: context.target.id,
          organizationId: context.target.organizationId,
          ...(context.target.meta ? { meta: context.target.meta } : {}),
        },
      });
    };
    return {
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
        {
          id: 'project.moveToProgram',
          relationId: 'project.program',
          responsiveness: PROJECT_RELATION_RESPONSIVENESS,
          label: 'Move to program',
          icon: Layers,
          objectKinds: ['project'],
          multi: true,
          section: 'organize',
          run: (context) => executeProject(context, 'project.program'),
        },
        {
          id: 'project.moveToTeam',
          relationId: 'project.team',
          responsiveness: PROJECT_RELATION_RESPONSIVENESS,
          label: 'Move to team',
          icon: Users,
          objectKinds: ['project'],
          multi: true,
          section: 'organize',
          run: (context) => executeProject(context, 'project.team'),
        },
        {
          id: 'project.linkInitiative',
          relationId: 'project.initiative',
          responsiveness: PROJECT_RELATION_RESPONSIVENESS,
          label: 'Link to initiative',
          icon: Flag,
          objectKinds: ['project'],
          multi: true,
          section: 'organize',
          run: (context) => executeProject(context, 'project.initiative'),
        },
        {
          id: 'project.setLead',
          relationId: 'project.lead',
          responsiveness: PROJECT_RELATION_RESPONSIVENESS,
          label: 'Set project lead',
          icon: User,
          objectKinds: ['project'],
          multi: true,
          section: 'organize',
          run: (context) => executeProject(context, 'project.lead'),
        },
        {
          id: 'project.addLabel',
          relationId: 'project.label',
          responsiveness: PROJECT_RELATION_RESPONSIVENESS,
          label: 'Add label',
          icon: Tag,
          objectKinds: ['project'],
          multi: true,
          section: 'organize',
          run: (context) => executeProject(context, 'project.label'),
        },
        {
          id: 'project.blocks',
          relationId: 'project.blocks',
          responsiveness: PROJECT_RELATION_RESPONSIVENESS,
          label: 'Create dependency',
          icon: Workflow,
          objectKinds: ['project'],
          section: 'organize',
          run: (context) => executeProject(context, 'project.blocks'),
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
        {
          id: 'program.linkInitiative',
          relationId: 'program.initiative',
          responsiveness: PROGRAM_RELATION_RESPONSIVENESS,
          label: 'Link to initiative',
          icon: Flag,
          objectKinds: ['program'],
          multi: true,
          section: 'organize',
          run: (context) => executeProgram(context, 'program.initiative'),
        },
        {
          id: 'program.setOwner',
          relationId: 'program.owner',
          responsiveness: PROGRAM_RELATION_RESPONSIVENESS,
          label: 'Set program owner',
          icon: User,
          objectKinds: ['program'],
          multi: true,
          section: 'organize',
          run: (context) => executeProgram(context, 'program.owner'),
        },
        {
          id: 'program.addLabel',
          relationId: 'program.label',
          responsiveness: PROGRAM_RELATION_RESPONSIVENESS,
          label: 'Add label',
          icon: Tag,
          objectKinds: ['program'],
          multi: true,
          section: 'organize',
          run: (context) => executeProgram(context, 'program.label'),
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
    };
  }, [pickerOverlay, queryClient, reportOutcome, router]);

  useRegisterActionDomain('project', domains.project);
  useRegisterActionDomain('program', domains.program);
  useRegisterActionDomain('cycle', domains.cycle);
  useRegisterActionDomain('team', domains.team);
}
