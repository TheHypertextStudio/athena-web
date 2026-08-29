'use client';

/** The Initiative action domain shared by lists, relationship tabs, and detail pages. */
import { ArrowRight, ArrowUp, CornerDownLeft, Plus, Tag, User, Users } from '@docket/ui/icons';
import { type InitiativeOverviewOut, InitiativeUpdate } from '@docket/types';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useAppRouter as useRouter } from '@/lib/interactions/navigation';
import { useCallback, useId, useMemo } from 'react';

import { copyObjectAction } from '@/components/actions/copy-object-action';
import { settleRelationExecution } from '@/components/actions/settle-relation-execution';
import { useCopyOutcome } from '@/components/clipboard';
import {
  invalidateInitiativeHierarchyRoute,
  writeInitiativeHierarchyMutation,
} from '@/components/initiatives/initiative-hierarchy-mutations';
import { useInitiativeHierarchyWriteCoordinator } from '@/components/initiatives/initiative-hierarchy-write-coordinator';
import {
  createInitiativeParentCommandPort,
  createInitiativePropertyCommandPort,
  type InitiativeParentIntent,
  resolveInitiativeParentIntent,
} from '@/components/initiatives/initiative-relation-port';
import { usePickerOverlay } from '@/components/pickers/picker-overlay';
import {
  type ActionContext,
  type ActionDefinition,
  defineActionDomain,
  objectHref,
  objectMetaString,
  type ObjectRef,
  useRegisterActionDomain,
} from '@/lib/actions';
import { api } from '@/lib/api';
import { initiativeOverviewDef } from '@/lib/fetch-initiative-overview';
import { unwrap } from '@/lib/query';
import { invalidateWorkTargetQueries } from '@/lib/work-target-invalidation';

const RELATION_RESPONSIVENESS = {
  // The shared relation adapter owns painted and spoken feedback for these commands.
  ownership: 'autonomous',
} as const;

/** Return the single Initiative named by a context. */
function initiativeFrom(
  context: ActionContext,
): (ObjectRef & { readonly kind: 'initiative' }) | null {
  const object = context.objects[0];
  return object?.kind === 'initiative' ? { ...object, kind: 'initiative' } : null;
}

/** Replace stale parent-edge facts with the route projection returned by a recovery refresh. */
function rebaseInitiativeParentIntent(
  intent: InitiativeParentIntent,
  overview: InitiativeOverviewOut,
): InitiativeParentIntent {
  const subject = intent.subjects[0];
  if (subject === undefined) return intent;
  const authoritative = overview.items.find((item) => item.id === subject.id);
  if (authoritative === undefined) return intent;
  return {
    ...intent,
    subjects: [
      {
        ...subject,
        meta: {
          ...subject.meta,
          parentInitiativeId: authoritative.parentInitiativeId,
          parentLinkId: authoritative.parentLinkId,
        },
      },
      ...intent.subjects.slice(1),
    ],
  };
}

function invalidateInitiativeOwner(
  queryClient: QueryClient,
  subjects: readonly { readonly kind: string; readonly organizationId: string | null }[],
  targetOrganizationId: string | null,
): Promise<void> {
  if (
    targetOrganizationId === null ||
    !subjects.some(
      (subject) => subject.kind === 'initiative' && subject.organizationId === targetOrganizationId,
    )
  )
    return Promise.resolve();
  return invalidateWorkTargetQueries(queryClient, {
    target: 'initiative',
    ownerOrganizationId: targetOrganizationId,
  });
}

/** Register the complete Initiative domain while the app interaction provider is mounted. */
export function useRegisterInitiativeActions(): void {
  const router = useRouter();
  const queryClient = useQueryClient();
  const pickerOverlay = usePickerOverlay();
  const reportOutcome = useCopyOutcome();
  const hierarchyCoordinator = useInitiativeHierarchyWriteCoordinator();
  const hierarchyActionOwnerId = useId();
  const parentPort = useMemo(
    () => createInitiativeParentCommandPort({ write: writeInitiativeHierarchyMutation }),
    [],
  );
  const hierarchyDisabledReason = useCallback(
    (context: ActionContext, allowOwnedRecovery: boolean): string | null => {
      const initiative = initiativeFrom(context);
      const organizationId = context.organizationId;
      if (initiative === null || organizationId === null) return null;
      const operation = hierarchyCoordinator.operationForChild(organizationId, initiative.id);
      if (operation === null) return null;
      if (
        allowOwnedRecovery &&
        operation.ownerId === hierarchyActionOwnerId &&
        operation.phase === 'refresh_failed'
      ) {
        return null;
      }
      return 'This initiative hierarchy is already being updated.';
    },
    [hierarchyActionOwnerId, hierarchyCoordinator],
  );
  const settleParentIntent = useCallback(
    async (intent: InitiativeParentIntent): Promise<void> => {
      let currentIntent = intent;
      let resolved = resolveInitiativeParentIntent(currentIntent);
      if (resolved === null) return;
      const stalled = hierarchyCoordinator.operationForChild(
        resolved.organizationId,
        resolved.mutation.childInitiativeId,
      );
      if (stalled?.ownerId === hierarchyActionOwnerId && stalled.phase === 'refresh_failed') {
        hierarchyCoordinator.transition(stalled.token, 'refreshing');
        try {
          await invalidateInitiativeHierarchyRoute(queryClient, resolved.organizationId);
          const overview = await queryClient.fetchQuery(
            initiativeOverviewDef(resolved.organizationId, api),
          );
          currentIntent = rebaseInitiativeParentIntent(currentIntent, overview);
          hierarchyCoordinator.release(stalled.token);
        } catch (error) {
          hierarchyCoordinator.transition(stalled.token, 'refresh_failed');
          throw error;
        }
        resolved = resolveInitiativeParentIntent(currentIntent);
        if (resolved === null) return;
      }
      const token = hierarchyCoordinator.claim({
        organizationId: resolved.organizationId,
        childInitiativeId: resolved.mutation.childInitiativeId,
        ownerId: hierarchyActionOwnerId,
        mutation: resolved.mutation,
      });
      if (token === null) return;
      try {
        await settleRelationExecution(
          () => parentPort.execute(currentIntent),
          async () => {
            hierarchyCoordinator.transition(token, 'refreshing');
            try {
              await invalidateInitiativeHierarchyRoute(queryClient, resolved.organizationId);
            } catch (error) {
              hierarchyCoordinator.transition(token, 'refresh_failed');
              throw error;
            }
          },
        );
      } finally {
        const operation = hierarchyCoordinator.operationForChild(
          resolved.organizationId,
          resolved.mutation.childInitiativeId,
        );
        if (operation?.token === token && operation.phase !== 'refresh_failed') {
          hierarchyCoordinator.release(token);
        }
      }
    },
    [hierarchyActionOwnerId, hierarchyCoordinator, parentPort, queryClient],
  );
  const propertyPort = useMemo(
    () =>
      createInitiativePropertyCommandPort({
        setProperty: async (organizationId, initiativeId, patch) => {
          await unwrap(
            () =>
              api.v1.orgs[':orgId'].initiatives[':id'].$patch({
                param: { orgId: organizationId, id: initiativeId },
                json: InitiativeUpdate.parse(patch),
              }),
            'Could not change the initiative relationship.',
          );
        },
        addLabel: async (organizationId, initiativeId, labelId) => {
          await unwrap(
            () =>
              api.v1.orgs[':orgId'].initiatives[':id'].labels.$post({
                param: { orgId: organizationId, id: initiativeId },
                json: { labelId },
              }),
            'Could not add the initiative label.',
          );
          return 'applied';
        },
      }),
    [],
  );

  const definitions = useMemo<readonly ActionDefinition[]>(
    () =>
      defineActionDomain('initiative', [
        {
          id: 'initiative.open',
          label: 'Open initiative',
          icon: ArrowRight,
          objectKinds: ['initiative'],
          section: 'primary',
          run: (context) => {
            const initiative = initiativeFrom(context);
            if (initiative === null) return;
            // Through `objectHref` so Open and a copied link can never point at different URLs.
            const href = objectHref(initiative);
            if (href !== null) router.push(href);
          },
        },
        copyObjectAction('initiative', reportOutcome),
        {
          id: 'initiative.changeParent',
          relationId: 'initiative.parent',
          responsiveness: RELATION_RESPONSIVENESS,
          label: 'Change parent…',
          icon: CornerDownLeft,
          objectKinds: ['initiative'],
          section: 'organize',
          disabledReason: (context) =>
            hierarchyDisabledReason(context, context.target?.kind === 'initiative'),
          run: async (context) => {
            const subject = initiativeFrom(context);
            const orgId = context.organizationId;
            if (subject === null || orgId === null) return;
            const target = context.target;
            if (target?.kind === 'initiative') {
              await settleParentIntent({
                relationId: 'initiative.parent',
                effect: 'move',
                subjects: [
                  {
                    kind: 'initiative',
                    id: subject.id,
                    organizationId: subject.organizationId,
                    ...(subject.meta === undefined ? {} : { meta: subject.meta }),
                  },
                ],
                target: {
                  kind: 'initiative',
                  id: target.id,
                  organizationId: orgId,
                  ...(target.meta === undefined ? {} : { meta: target.meta }),
                },
              });
              return;
            }
            pickerOverlay.open({
              kind: 'initiative-hierarchy',
              mode: 'parent',
              organizationId: orgId,
              subject,
            });
          },
        },
        {
          id: 'initiative.addSubinitiative',
          label: 'Add sub-initiative…',
          icon: Plus,
          objectKinds: ['initiative'],
          section: 'organize',
          run: (context) => {
            const subject = initiativeFrom(context);
            if (subject === null || context.organizationId === null) return;
            pickerOverlay.open({
              kind: 'initiative-hierarchy',
              mode: 'child',
              organizationId: context.organizationId,
              subject,
            });
          },
        },
        {
          id: 'initiative.setLeadTeam',
          relationId: 'initiative.lead-team',
          responsiveness: RELATION_RESPONSIVENESS,
          label: 'Set lead team',
          icon: Users,
          objectKinds: ['initiative'],
          multi: true,
          section: 'organize',
          run: async (context) => {
            if (context.organizationId === null) return;
            if (context.target === undefined) {
              pickerOverlay.open({
                kind: 'relation-target',
                relationId: 'initiative.lead-team',
                organizationId: context.organizationId,
                subjects: context.objects,
              });
              return;
            }
            if (context.target.kind !== 'team') return;
            const target = context.target;
            const subjects = context.objects
              .filter((object) => object.kind === 'initiative')
              .map((object) => ({
                kind: 'initiative' as const,
                id: object.id,
                organizationId: object.organizationId,
                ...(object.meta ? { meta: object.meta } : {}),
              }));
            await settleRelationExecution(
              () =>
                propertyPort.execute({
                  relationId: 'initiative.lead-team',
                  effect: 'move',
                  subjects,
                  target: {
                    kind: 'team',
                    id: target.id,
                    organizationId: target.organizationId,
                  },
                }),
              () => invalidateInitiativeOwner(queryClient, subjects, target.organizationId),
            );
          },
        },
        {
          id: 'initiative.setOwner',
          relationId: 'initiative.owner',
          responsiveness: RELATION_RESPONSIVENESS,
          label: 'Set owner',
          icon: User,
          objectKinds: ['initiative'],
          multi: true,
          section: 'organize',
          run: async (context) => {
            if (context.organizationId === null) return;
            if (context.target === undefined) {
              pickerOverlay.open({
                kind: 'relation-target',
                relationId: 'initiative.owner',
                organizationId: context.organizationId,
                subjects: context.objects,
              });
              return;
            }
            if (context.target.kind !== 'actor') return;
            const target = context.target;
            const subjects = context.objects
              .filter((object) => object.kind === 'initiative')
              .map((object) => ({
                kind: 'initiative' as const,
                id: object.id,
                organizationId: object.organizationId,
                ...(object.meta ? { meta: object.meta } : {}),
              }));
            await settleRelationExecution(
              () =>
                propertyPort.execute({
                  relationId: 'initiative.owner',
                  effect: 'move',
                  subjects,
                  target: {
                    kind: 'actor',
                    id: target.id,
                    organizationId: target.organizationId,
                  },
                }),
              () => invalidateInitiativeOwner(queryClient, subjects, target.organizationId),
            );
          },
        },
        {
          id: 'initiative.addLabel',
          relationId: 'initiative.label',
          responsiveness: RELATION_RESPONSIVENESS,
          label: 'Add label',
          icon: Tag,
          objectKinds: ['initiative'],
          multi: true,
          section: 'organize',
          run: async (context) => {
            if (context.organizationId === null) return;
            if (context.target === undefined) {
              pickerOverlay.open({
                kind: 'relation-target',
                relationId: 'initiative.label',
                organizationId: context.organizationId,
                subjects: context.objects,
              });
              return;
            }
            if (context.target.kind !== 'label') return;
            const target = context.target;
            const subjects = context.objects
              .filter((object) => object.kind === 'initiative')
              .map((object) => ({
                kind: 'initiative' as const,
                id: object.id,
                organizationId: object.organizationId,
                ...(object.meta ? { meta: object.meta } : {}),
              }));
            await settleRelationExecution(
              () =>
                propertyPort.execute({
                  relationId: 'initiative.label',
                  effect: 'link',
                  subjects,
                  target: {
                    kind: 'label',
                    id: target.id,
                    organizationId: target.organizationId,
                  },
                }),
              () => invalidateInitiativeOwner(queryClient, subjects, target.organizationId),
            );
          },
        },
        {
          id: 'initiative.moveToTopLevel',
          relationId: 'initiative.root',
          responsiveness: RELATION_RESPONSIVENESS,
          label: 'Move to top level',
          icon: ArrowUp,
          objectKinds: ['initiative'],
          section: 'organize',
          disabledReason: (context) => hierarchyDisabledReason(context, true),
          appliesTo: (context) => {
            const initiative = initiativeFrom(context);
            return initiative !== null && objectMetaString(initiative, 'parentLinkId') !== null;
          },
          run: async (context) => {
            const initiative = initiativeFrom(context);
            const orgId = context.organizationId;
            if (initiative === null || orgId === null) return;
            await settleParentIntent({
              relationId: 'initiative.root',
              effect: 'move',
              subjects: [
                {
                  kind: 'initiative',
                  id: initiative.id,
                  organizationId: initiative.organizationId,
                  ...(initiative.meta ? { meta: initiative.meta } : {}),
                },
              ],
              target: {
                kind: 'initiative_root',
                id: `${orgId}:initiative-root`,
                organizationId: orgId,
              },
            });
          },
        },
      ]),
    [
      hierarchyDisabledReason,
      pickerOverlay,
      propertyPort,
      queryClient,
      reportOutcome,
      router,
      settleParentIntent,
    ],
  );

  useRegisterActionDomain('initiative', definitions);
}
