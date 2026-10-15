'use client';

import { Building, LayoutTemplate } from '@docket/ui/icons';
import { useVocabulary } from '@docket/ui/hooks';
import { useAppRouter as useRouter } from '@/lib/interactions/navigation';
import { useMemo } from 'react';
import type { TemplateOut } from '@docket/work/template-contract';
import type { WorkTemplateOut } from '@docket/work/work-template-contract';

import { workTemplatesDef } from '@/components/templates/work-template-queries';
import { useActiveOrg } from '@/components/active-org';
import { useCreateObject } from '@/components/create-object/create-object-provider';
import {
  sortTemplates,
  templateMatchesContext,
  templatesDef,
} from '@/components/templates/queries';
import { api } from '@/lib/api';
import { fetchAllMembers } from '@/lib/org-collection-pages';
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
  const publications = useApiQuery({
    ...workTemplatesDef(activeOrgId ?? ''),
    enabled: open && activeOrgId !== null,
  });
  const membersQuery = useApiListQuery(
    apiQueryOptions(
      queryKeys.members(activeOrgId ?? ''),
      () => fetchAllMembers(api, activeOrgId ?? ''),
      'Could not load members.',
      { enabled: open && activeOrgId !== null, staleTime: STALE.static },
    ),
  );
  const currentActorId =
    membersQuery.data?.items.find((member) => member.userId === session?.user.id)?.actorId ?? null;
  const scopedTemplates = useMemo(
    () =>
      commandTemplates({
        items: templatesQuery.data?.items,
        currentActorId,
        defaultTeamId,
        publications: publications.data?.items,
      }),
    [currentActorId, defaultTeamId, publications.data?.items, templatesQuery.data?.items],
  );

  return useMemo(() => {
    const items: PaletteItem[] = [];
    if (activeOrgId) {
      for (const template of sortTemplates(scopedTemplates)) {
        const noun = nounFor[template.targetType];
        items.push({
          id: `template:${template.id}`,
          section: 'templates',
          label:
            template.scope === 'organization'
              ? `New ${template.name}`
              : `New ${noun.toLocaleLowerCase()} from ${template.name} · Draft`,
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

    items.push(...workspaceCommands({ orgs, router, close }));

    return items;
  }, [activeOrgId, close, nounFor, openCreate, orgName, orgs, router, scopedTemplates]);
}

function commandTemplates({
  items,
  currentActorId,
  defaultTeamId,
  publications,
}: {
  items: readonly TemplateOut[] | undefined;
  currentActorId: string | null;
  defaultTeamId: string | null;
  publications: readonly WorkTemplateOut[] | undefined;
}): readonly TemplateOut[] {
  return (items ?? []).filter(
    (template) =>
      templateMatchesContext(
        template,
        currentActorId,
        template.targetType === 'task' || template.targetType === 'project' ? defaultTeamId : null,
      ) &&
      (template.scope !== 'organization' ||
        publications?.some(
          (item) =>
            item.id === template.id &&
            (item.offeredTeamIds.length === 0 ||
              item.offeredTeamIds.some((id) => id === defaultTeamId)),
        )),
  );
}
function workspaceCommands({
  orgs,
  router,
  close,
}: {
  orgs: ReturnType<typeof useActiveOrg>['orgs'];
  router: ReturnType<typeof useRouter>;
  close: () => void;
}): PaletteItem[] {
  return orgs.map((org) => ({
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
  }));
}
