'use client';

import { Building, LayoutTemplate } from '@docket/ui/icons';
import { useVocabulary } from '@docket/ui/hooks';
import { useAppRouter as useRouter } from '@/lib/interactions/navigation';
import { useMemo } from 'react';

import { useActiveOrg } from '@/components/active-org';
import { useCreateObject } from '@/components/create-object/create-object-provider';
import {
  sortTemplates,
  templateMatchesContext,
  templatesDef,
} from '@/components/templates/queries';
import { api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { apiQueryOptions, queryKeys, STALE, useApiListQuery, useApiQuery } from '@/lib/query';

import type { PaletteItem } from './types';

/** Inputs for the palette's dynamic template and workspace commands. */
interface CommandActionsInput {
  /** Whether the palette is open; dynamic reads are skipped while it is closed. */
  readonly open: boolean;
  /** Close the palette before executing a command. */
  readonly close: () => void;
}

/** Build dynamic template creation and workspace-switch commands. */
export function useCommandActions({ open, close }: CommandActionsInput): readonly PaletteItem[] {
  const router = useRouter();
  const { openCreate } = useCreateObject();
  const { orgs, activeOrgId, defaultTeamId, orgName } = useActiveOrg();
  const { data: session } = authClient.useSession();
  const task = useVocabulary('task');
  const project = useVocabulary('project');
  const initiative = useVocabulary('initiative');
  const program = useVocabulary('program');
  const nounFor = useMemo(
    () => ({ task, project, initiative, program }),
    [initiative, program, project, task],
  );

  const templatesQuery = useApiQuery({
    ...templatesDef(activeOrgId ?? ''),
    enabled: open && activeOrgId !== null,
  });
  const membersQuery = useApiListQuery(
    apiQueryOptions(
      queryKeys.members(activeOrgId ?? ''),
      () => api.v1.orgs[':orgId'].members.$get({ param: { orgId: activeOrgId ?? '' } }),
      'Could not load members.',
      { enabled: open && activeOrgId !== null, staleTime: STALE.static },
    ),
  );
  const currentActorId =
    membersQuery.data?.items.find((member) => member.userId === session?.user.id)?.actorId ?? null;
  const scopedTemplates = useMemo(
    () =>
      templatesQuery.data?.items.filter((template) =>
        templateMatchesContext(
          template,
          currentActorId,
          template.targetType === 'task' || template.targetType === 'project'
            ? defaultTeamId
            : null,
        ),
      ),
    [currentActorId, defaultTeamId, templatesQuery.data?.items],
  );

  return useMemo(() => {
    const items: PaletteItem[] = [];
    if (activeOrgId && scopedTemplates) {
      for (const template of sortTemplates(scopedTemplates)) {
        const noun = nounFor[template.targetType];
        items.push({
          id: `template:${template.id}`,
          section: 'templates',
          label: `New ${noun.toLocaleLowerCase()} from ${template.name}`,
          hint: noun,
          icon: LayoutTemplate,
          keywords: [template.name, noun, 'template', 'new', 'create'],
          org: { id: activeOrgId, name: orgName(activeOrgId) },
          requiresQuery: true,
          run: () => {
            close();
            openCreate({
              kind: template.targetType,
              initialWorkspaceId: activeOrgId,
              sameWorkspaceCompletion: 'open',
              defaultTemplateId: template.id,
            });
          },
        });
      }
    }

    for (const org of orgs) {
      items.push({
        id: `org:${org.id}`,
        section: 'organizations',
        label: `Switch to ${org.name}`,
        icon: Building,
        keywords: [org.name, org.slug],
        org: { id: org.id, name: org.name },
        run: () => {
          close();
          router.push(`/orgs/${org.id}/my-work`);
        },
      });
    }

    return items;
  }, [activeOrgId, close, nounFor, openCreate, orgName, orgs, router, scopedTemplates]);
}
