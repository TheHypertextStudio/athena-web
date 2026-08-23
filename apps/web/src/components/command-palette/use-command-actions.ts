'use client';

import { useQueryClient } from '@tanstack/react-query';

import { DENSITIES, useContextState } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import {
  Building,
  FolderKanban,
  GanttChart,
  Home,
  Inbox,
  Layers,
  LayoutTemplate,
  Library,
  ListChecks,
  LogOut,
  Plus,
  Settings,
  Sparkles,
  Target,
} from '@docket/ui/icons';
import { useRouter } from 'next/navigation';
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
import { signOutAndPurge } from '@/lib/sign-out';
import { CREATE_WORKSPACE_PATH } from '@/lib/workspace-creation';

import type { PaletteItem, PaletteScope } from './types';

/**
 * The four template-backed kinds the palette can create directly.
 *
 * @remarks
 * Labels are resolved through the workspace's vocabulary at build time below, so a workspace that
 * calls Initiatives "Campaigns" gets "New campaign" rather than a term nobody there uses.
 */
const CREATABLE = [
  { kind: 'task', keywords: ['new', 'create', 'add', 'issue'] },
  { kind: 'project', keywords: ['new', 'create', 'add'] },
  { kind: 'initiative', keywords: ['new', 'create', 'add', 'goal', 'theme'] },
  { kind: 'program', keywords: ['new', 'create', 'add', 'stream'] },
] as const;

/** The org-scoped sidebar destinations a command can jump to, with labels + glyphs. */
const ORG_DESTINATIONS = [
  { key: 'my-work', label: 'My Work', icon: ListChecks, keywords: ['tasks', 'assigned'] },
  { key: 'triage', label: 'Triage', icon: Inbox, keywords: ['inbox', 'unsorted'] },
  { key: 'athena', label: 'Athena', icon: Sparkles, keywords: ['chat', 'assistant', 'ask'] },
  { key: 'initiatives', label: 'Initiatives', icon: Target, keywords: ['goals'] },
  { key: 'programs', label: 'Programs', icon: FolderKanban, keywords: ['streams'] },
  { key: 'projects', label: 'Projects', icon: FolderKanban, keywords: [] },
  { key: 'cycles', label: 'Cycles', icon: GanttChart, keywords: ['sprints'] },
  {
    key: 'library',
    label: 'Library',
    icon: Library,
    keywords: ['resources', 'documents', 'docs', 'files', 'links'],
  },
  { key: 'agents', label: 'Agents', icon: Sparkles, keywords: ['ai', 'sessions'] },
  { key: 'settings', label: 'Settings', icon: Settings, keywords: ['preferences', 'org'] },
] as const;

/** Inputs the command builder needs from the palette host. */
interface CommandActionsInput {
  /** The active search scope (governs org-local navigation availability). */
  scope: PaletteScope;
  /** Whether the palette is open; the template read is skipped while it is not. */
  open: boolean;
  /** Close the palette; every command calls this immediately before navigating. */
  close: () => void;
}

/**
 * Build the palette's static commands: navigation jumps, actions, and org switches.
 *
 * @remarks
 * The non-search half of the palette. It assembles three sections, memoized against the
 * active-org state and scope:
 *
 * - **navigation** — the Hub destinations (Today, Inbox, Portfolio) always; when an org is
 *   bound (and the scope is `org`) the org-scoped sidebar destinations for that org, each
 *   org-chipped.
 * - **actions** — global actions (create each kind of work, new organization, sign out).
 * - **templates** — one "New {kind} from {template}" command per template in the bound org,
 *   hidden until the user types (see {@link PaletteItem.requiresQuery}).
 * - **organizations** — one "switch to <org>" command per membership, org-chipped.
 *
 * A create command opens the shell-global composer directly. It does not navigate away from the
 * page under the palette, and template commands carry their template id in the opening request.
 *
 * Every command closes the palette before performing its navigation/effect, so selection
 * feels instant and the overlay never lingers.
 *
 * @param input - The active scope, open state, and the palette's `close` callback.
 * @returns the static commands in display order.
 */
export function useCommandActions({
  scope,
  open,
  close,
}: CommandActionsInput): readonly PaletteItem[] {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { openCreate } = useCreateObject();
  const { orgs, activeOrgId, defaultTeamId, orgName } = useActiveOrg();
  const { data: session } = authClient.useSession();
  const { density, setDensity } = useContextState();
  const taskNoun = useVocabulary('task');
  const projectNoun = useVocabulary('project');
  const initiativeNoun = useVocabulary('initiative');
  const programNoun = useVocabulary('program');

  const templatesQuery = useApiQuery({
    ...templatesDef(activeOrgId ?? ''),
    enabled: open && activeOrgId !== null,
  });
  const templateItems = templatesQuery.data?.items;
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
  const scopedTemplateItems = useMemo(
    () =>
      templateItems?.filter((template) =>
        templateMatchesContext(
          template,
          currentActorId,
          template.targetType === 'task' || template.targetType === 'project'
            ? defaultTeamId
            : null,
        ),
      ),
    [currentActorId, defaultTeamId, templateItems],
  );

  const nounFor = useMemo<Record<(typeof CREATABLE)[number]['kind'], string>>(
    () => ({
      task: taskNoun,
      project: projectNoun,
      initiative: initiativeNoun,
      program: programNoun,
    }),
    [taskNoun, projectNoun, initiativeNoun, programNoun],
  );

  return useMemo<readonly PaletteItem[]>(() => {
    /** Wrap a navigation in the close-then-push lifecycle every command shares. */
    const go = (href: string) => () => {
      close();
      router.push(href);
    };

    /** Open a global composer while preserving the page under the palette. */
    const create = (kind: (typeof CREATABLE)[number]['kind'], defaultTemplateId?: string) => () => {
      close();
      if (!activeOrgId) return;
      openCreate({
        kind,
        initialWorkspaceId: activeOrgId,
        sameWorkspaceCompletion: 'open',
        ...(defaultTemplateId === undefined ? {} : { defaultTemplateId }),
      });
    };

    const items: PaletteItem[] = [];

    // ── Navigation: Hub destinations (always available) ──────────────────────
    items.push(
      {
        id: 'nav:today',
        section: 'navigation',
        label: 'Go to Today',
        hint: 'Hub',
        icon: Home,
        keywords: ['hub', 'home', 'plan', 'day'],
        run: go('/today'),
      },
      {
        id: 'nav:inbox',
        section: 'navigation',
        label: 'Go to Inbox',
        hint: 'Hub',
        icon: Inbox,
        keywords: ['notifications', 'unread', 'approvals'],
        run: go('/inbox'),
      },
      {
        id: 'nav:portfolio',
        section: 'navigation',
        label: 'Go to Portfolio',
        hint: 'Hub',
        icon: GanttChart,
        keywords: ['timeline', 'roadmap', 'programs', 'projects'],
        run: go('/portfolio'),
      },
      {
        id: 'nav:settings',
        section: 'navigation',
        label: 'Go to Settings',
        icon: Settings,
        keywords: ['preferences', 'profile', 'account', 'security', 'notifications'],
        run: go('/settings'),
      },
    );

    // ── Navigation: org-scoped sections for the bound org (org scope only) ────
    if (scope === 'org' && activeOrgId) {
      const name = orgName(activeOrgId);
      for (const dest of ORG_DESTINATIONS) {
        items.push({
          id: `nav:org:${dest.key}`,
          section: 'navigation',
          label: dest.label,
          icon: dest.icon,
          keywords: dest.keywords,
          org: { id: activeOrgId, name },
          run: go(`/orgs/${activeOrgId}/${dest.key}`),
        });
      }
    }

    // ── Actions: create one of each kind of work, in the bound org ────────────
    // Gated on a bound org, NOT on the scope toggle. That toggle governs how wide a *search*
    // reaches and which navigation destinations are offered; it says nothing about where a new
    // task would land, which is always the org the route is in. Gating on it meant the palette
    // opened in Hub scope — its default — and offered no way to create anything at all.
    if (activeOrgId) {
      const name = orgName(activeOrgId);
      for (const creatable of CREATABLE) {
        const noun = nounFor[creatable.kind];
        items.push({
          id: `action:new:${creatable.kind}`,
          section: 'actions',
          label: `New ${noun.toLowerCase()}`,
          icon: Plus,
          keywords: [...creatable.keywords, noun],
          org: { id: activeOrgId, name },
          run: create(creatable.kind),
        });
      }
    }

    // ── Actions: global ───────────────────────────────────────────────────────
    items.push(
      {
        id: 'action:new-org',
        section: 'actions',
        label: 'Create workspace',
        icon: Plus,
        keywords: ['create', 'join', 'organization', 'new'],
        run: go(CREATE_WORKSPACE_PATH),
      },
      {
        id: 'action:density',
        section: 'actions',
        label: `Switch density to ${DENSITIES[(DENSITIES.indexOf(density) + 1) % DENSITIES.length] ?? 'comfortable'}`,
        hint: `now ${density}`,
        icon: Layers,
        keywords: ['density', 'compact', 'comfortable', 'spacious', 'rows', 'spacing'],
        run: () => {
          close();
          setDensity(
            DENSITIES[(DENSITIES.indexOf(density) + 1) % DENSITIES.length] ?? 'comfortable',
          );
        },
      },
      {
        id: 'action:sign-out',
        section: 'actions',
        label: 'Sign out',
        icon: LogOut,
        keywords: ['log out', 'logout', 'leave'],
        run: () => {
          close();
          // Centralized: see `lib/sign-out.ts` — clearing persisted entity snapshots on the way
          // out is what stops the next person on a shared device seeing this one's data.
          void signOutAndPurge(queryClient);
        },
      },
    );

    // ── Templates: one command per template, hidden until the user types ──────
    if (activeOrgId && scopedTemplateItems) {
      const name = orgName(activeOrgId);
      for (const template of sortTemplates(scopedTemplateItems)) {
        const noun = nounFor[template.targetType];
        items.push({
          id: `template:${template.id}`,
          section: 'templates',
          label: `New ${noun.toLowerCase()} from ${template.name}`,
          hint: noun,
          icon: LayoutTemplate,
          keywords: [template.name, noun, 'template', 'new', 'create'],
          org: { id: activeOrgId, name },
          requiresQuery: true,
          run: create(template.targetType, template.id),
        });
      }
    }

    // ── Organizations: switch context ─────────────────────────────────────────
    for (const org of orgs) {
      items.push({
        id: `org:${org.id}`,
        section: 'organizations',
        label: `Switch to ${org.name}`,
        icon: Building,
        keywords: [org.name, org.slug],
        org: { id: org.id, name: org.name },
        run: go(`/orgs/${org.id}/my-work`),
      });
    }

    return items;
  }, [
    scope,
    activeOrgId,
    orgs,
    orgName,
    router,
    close,
    density,
    setDensity,
    scopedTemplateItems,
    nounFor,
    openCreate,
  ]);
}
