'use client';

/** The Initiative action domain shared by lists, relationship tabs, and detail pages. */
import { ArrowRight, ArrowUp, CornerDownLeft, Plus } from '@docket/ui/icons';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';

import {
  initiativeDragObjectFromRef,
  writeInitiativeHierarchyMutation,
} from '@/components/initiatives/initiative-hierarchy-mutations';
import { usePickerOverlay } from '@/components/pickers/picker-overlay';
import {
  type ActionContext,
  type ActionDefinition,
  defineActionDomain,
  objectMetaString,
  type ObjectRef,
  useRegisterActionDomain,
} from '@/lib/actions';
import { queryKeys } from '@/lib/query';

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
            router.push(`/orgs/${context.organizationId}/initiatives/${initiative.id}`);
          },
        },
        {
          id: 'initiative.changeParent',
          label: 'Change parent…',
          icon: CornerDownLeft,
          objectKinds: ['initiative'],
          section: 'organize',
          run: (context) => {
            const subject = initiativeFrom(context);
            if (subject === null || context.organizationId === null) return;
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
          id: 'initiative.moveToTopLevel',
          responsiveness: {
            ownership: 'root',
            interactionId: 'app.mutation',
            category: 'mutation',
            routeTemplateId: '/initiatives/[initiativeId]',
          } as const,
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
            const dragged = initiativeDragObjectFromRef(initiative);
            if (dragged.parentLinkId === null) return;
            await writeInitiativeHierarchyMutation(orgId, {
              kind: 'detach',
              linkId: dragged.parentLinkId,
              childInitiativeId: initiative.id,
            });
            await queryClient.invalidateQueries({ queryKey: queryKeys.initiatives(orgId) });
          },
        },
      ]),
    [pickerOverlay, queryClient, router],
  );

  useRegisterActionDomain('initiative', definitions);
}
