'use client';

/** The Initiative action domain shared by lists, relationship tabs, and detail pages. */
import { ArrowRight, ArrowUp, CornerDownLeft, Plus, Tag, User, Users } from '@docket/ui/icons';
import { InitiativeUpdate } from '@docket/types';
import { useQueryClient } from '@tanstack/react-query';
import { useAppRouter as useRouter } from '@/lib/interactions/navigation';
import { useMemo } from 'react';

import { copyObjectAction } from '@/components/actions/copy-object-action';
import { useCopyOutcome } from '@/components/clipboard';
import { writeInitiativeHierarchyMutation } from '@/components/initiatives/initiative-hierarchy-mutations';
import {
  createInitiativeParentCommandPort,
  createInitiativePropertyCommandPort,
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
import { queryKeys } from '@/lib/query';
import { api } from '@/lib/api';
import { unwrap } from '@/lib/query';

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

/** Register the complete Initiative domain while the app interaction provider is mounted. */
export function useRegisterInitiativeActions(): void {
  const router = useRouter();
  const queryClient = useQueryClient();
  const pickerOverlay = usePickerOverlay();
  const reportOutcome = useCopyOutcome();
  const parentPort = useMemo(
    () => createInitiativeParentCommandPort({ write: writeInitiativeHierarchyMutation }),
    [],
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
          await queryClient.invalidateQueries({
            queryKey: queryKeys.initiatives(organizationId),
          });
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
          await queryClient.invalidateQueries({
            queryKey: queryKeys.initiatives(organizationId),
          });
          return 'applied';
        },
      }),
    [queryClient],
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
            if (initiative === null || context.organizationId === null) return;
            // Through `objectHref` so Open and a copied link can never point at different URLs.
            const href = objectHref({ ...initiative, organizationId: context.organizationId });
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
          run: async (context) => {
            const subject = initiativeFrom(context);
            if (subject === null || context.organizationId === null) return;
            if (context.target?.kind === 'initiative') {
              await parentPort.execute({
                relationId: 'initiative.parent',
                effect: 'move',
                subjects: [
                  {
                    kind: 'initiative',
                    id: subject.id,
                    organizationId: context.organizationId,
                    ...(subject.meta === undefined ? {} : { meta: subject.meta }),
                  },
                ],
                target: {
                  kind: 'initiative',
                  id: context.target.id,
                  organizationId: context.organizationId,
                  ...(context.target.meta === undefined ? {} : { meta: context.target.meta }),
                },
              });
              await queryClient.invalidateQueries({
                queryKey: queryKeys.initiatives(context.organizationId),
              });
              return;
            }
            pickerOverlay.open({
              kind: 'initiative-hierarchy',
              mode: 'parent',
              organizationId: context.organizationId,
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
            const subjects = context.objects
              .filter((object) => object.kind === 'initiative')
              .map((object) => ({
                kind: 'initiative' as const,
                id: object.id,
                organizationId: context.organizationId,
                ...(object.meta ? { meta: object.meta } : {}),
              }));
            await propertyPort.execute({
              relationId: 'initiative.lead-team',
              effect: 'move',
              subjects,
              target: {
                kind: 'team',
                id: context.target.id,
                organizationId: context.organizationId,
              },
            });
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
            await propertyPort.execute({
              relationId: 'initiative.owner',
              effect: 'move',
              subjects: context.objects
                .filter((object) => object.kind === 'initiative')
                .map((object) => ({
                  kind: 'initiative' as const,
                  id: object.id,
                  organizationId: context.organizationId,
                  ...(object.meta ? { meta: object.meta } : {}),
                })),
              target: {
                kind: 'actor',
                id: context.target.id,
                organizationId: context.organizationId,
              },
            });
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
            await propertyPort.execute({
              relationId: 'initiative.label',
              effect: 'link',
              subjects: context.objects
                .filter((object) => object.kind === 'initiative')
                .map((object) => ({
                  kind: 'initiative' as const,
                  id: object.id,
                  organizationId: context.organizationId,
                  ...(object.meta ? { meta: object.meta } : {}),
                })),
              target: {
                kind: 'label',
                id: context.target.id,
                organizationId: context.organizationId,
              },
            });
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
          appliesTo: (context) => {
            const initiative = initiativeFrom(context);
            return initiative !== null && objectMetaString(initiative, 'parentLinkId') !== null;
          },
          run: async (context) => {
            const initiative = initiativeFrom(context);
            const orgId = context.organizationId;
            if (initiative === null || orgId === null) return;
            await parentPort.execute({
              relationId: 'initiative.root',
              effect: 'move',
              subjects: [
                {
                  kind: 'initiative',
                  id: initiative.id,
                  organizationId: orgId,
                  ...(initiative.meta ? { meta: initiative.meta } : {}),
                },
              ],
              target: {
                kind: 'initiative_root',
                id: `${orgId}:initiative-root`,
                organizationId: orgId,
              },
            });
            await queryClient.invalidateQueries({ queryKey: queryKeys.initiatives(orgId) });
          },
        },
      ]),
    [parentPort, pickerOverlay, propertyPort, queryClient, router, reportOutcome],
  );

  useRegisterActionDomain('initiative', definitions);
}
