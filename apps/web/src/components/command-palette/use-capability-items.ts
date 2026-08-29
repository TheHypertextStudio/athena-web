'use client';

import { useQueryClient } from '@tanstack/react-query';
import { DENSITIES, useContextState } from '@docket/ui/components';
import { useVocabulary } from '@docket/ui/hooks';
import { useMemo } from 'react';

import { useActiveOrg } from '@/components/active-org';
import {
  ACTION_CAPABILITIES,
  HOME_CAPABILITIES,
  PANEL_CAPABILITIES,
  WORKSPACE_CAPABILITIES,
} from '@/components/app-catalog/shell-capabilities';
import {
  executeCapabilityTarget,
  type CapabilityExecutor,
} from '@/components/app-catalog/executor';
import {
  resolveCapabilities,
  type CapabilityContext,
  type CapabilityTarget,
} from '@/components/app-catalog';
import { useCreateObject } from '@/components/create-object/create-object-provider';
import { useOptionalAuthenticationInterlock } from '@/components/authentication-interlock';
import { SETTINGS_CAPABILITIES } from '@/components/settings/settings-capabilities';
import { useCanManageOrg } from '@/components/settings/use-can-manage-org';
import { useAppRouter as useRouter } from '@/lib/interactions/navigation';
import { withRouteFragmentFocusHint } from '@/lib/interactions/route-fragment-focus';
import { SignOutCleanupError, signOutAndPurge } from '@/lib/sign-out';
import { CREATE_WORKSPACE_PATH } from '@/lib/workspace-creation';

import type { PaletteItem, PaletteSection } from './types';

const CATALOG = [
  ...HOME_CAPABILITIES,
  ...WORKSPACE_CAPABILITIES,
  ...PANEL_CAPABILITIES,
  ...ACTION_CAPABILITIES,
  ...SETTINGS_CAPABILITIES,
] as const;

const MAX_FRAGMENT_FOCUS_FRAMES = 120;

function focusRouteFragmentAfterNavigation(href: string): void {
  const hashIndex = href.indexOf('#');
  if (hashIndex < 0) return;
  const expectedHash = href.slice(hashIndex);
  const id = decodeURIComponent(expectedHash.slice(1));
  let attempts = 0;
  const findDestination = (): void => {
    const destination = document.getElementById(id);
    if (window.location.hash === expectedHash && destination instanceof HTMLElement) {
      // The Settings dialog applies initial focus as it mounts. One final frame lets that
      // one-time move finish before the routed destination takes focus.
      requestAnimationFrame(() => {
        const mountedDestination = document.getElementById(id);
        if (!(mountedDestination instanceof HTMLElement)) return;
        mountedDestination.scrollIntoView({ block: 'start' });
        mountedDestination.focus({ preventScroll: true });
        if (document.activeElement !== mountedDestination && attempts < MAX_FRAGMENT_FOCUS_FRAMES) {
          attempts += 1;
          requestAnimationFrame(findDestination);
        }
      });
      return;
    }
    attempts += 1;
    // Two seconds at 60fps covers a streamed route without leaving an unbounded animation loop
    // when navigation fails or another command supersedes this one.
    if (attempts < MAX_FRAGMENT_FOCUS_FRAMES) requestAnimationFrame(findDestination);
  };
  requestAnimationFrame(findDestination);
}

function sectionFor(target: CapabilityTarget): PaletteSection {
  if (target.type === 'route') return 'navigation';
  if (target.intent.type === 'open-panel') return 'panels';
  return 'actions';
}

interface CapabilityItemsInput {
  readonly open: boolean;
  readonly close: () => void;
  readonly panelsAvailable: boolean;
  readonly onOpenPanel: (panelId: 'agenda' | 'focus' | 'athena') => void;
  readonly sessionOwnerUserId: string | null;
}

/** Resolve feature-owned application capabilities into executable palette rows. */
export function useCapabilityItems({
  open,
  close,
  panelsAvailable,
  onOpenPanel,
  sessionOwnerUserId,
}: CapabilityItemsInput): readonly PaletteItem[] {
  const router = useRouter();
  const queryClient = useQueryClient();
  const authentication = useOptionalAuthenticationInterlock();
  const { activeOrgId, density, setDensity } = useContextState();
  const { orgs, orgName } = useActiveOrg();
  const { openCreate } = useCreateObject();
  const { canManage } = useCanManageOrg(activeOrgId ?? '', { enabled: open });
  const task = useVocabulary('task');
  const initiative = useVocabulary('initiative', { plural: true });
  const program = useVocabulary('program', { plural: true });
  const project = useVocabulary('project', { plural: true });
  const cycle = useVocabulary('cycle', { plural: true });
  const team = useVocabulary('team', { plural: true });

  return useMemo(() => {
    const activeOrg = orgs.find((org) => org.id === activeOrgId) ?? null;
    const context: CapabilityContext = {
      activeOrgId,
      activeOrgName: activeOrgId ? orgName(activeOrgId) : null,
      activeOrgIsPersonal: activeOrg?.isPersonal ?? false,
      canManageActiveOrg: canManage,
      panelsAvailable,
      vocabulary: { task, initiative, program, project, cycle, team },
    };
    const executor: CapabilityExecutor = {
      navigate: (href) => {
        router.push(withRouteFragmentFocusHint(href));
        focusRouteFragmentAfterNavigation(href);
      },
      openPanel: onOpenPanel,
      openCreate: (kind, templateId) => {
        if (!activeOrgId) return;
        openCreate({
          kind,
          initialWorkspaceId: activeOrgId,
          sameWorkspaceCompletion: 'open',
          ...(templateId ? { defaultTemplateId: templateId } : {}),
        });
      },
      createWorkspace: () => {
        router.push(CREATE_WORKSPACE_PATH);
      },
      cycleDensity: () => {
        const index = DENSITIES.indexOf(density);
        setDensity(DENSITIES[(index + 1) % DENSITIES.length] ?? 'comfortable');
      },
      signOut: () => {
        if (sessionOwnerUserId === null) {
          authentication?.reportSignOutFailure();
          return;
        }
        void signOutAndPurge(queryClient, sessionOwnerUserId).catch((error: unknown) => {
          if (error instanceof SignOutCleanupError) {
            authentication?.reportSessionCleanupFailure();
            return;
          }
          authentication?.reportSignOutFailure();
        });
      },
    };

    return resolveCapabilities(CATALOG, context).map((capability): PaletteItem => ({
      id: capability.id,
      section: sectionFor(capability.target),
      label: capability.label,
      description: capability.description,
      hint: capability.breadcrumb.length > 0 ? capability.breadcrumb.join(' › ') : undefined,
      breadcrumb: capability.breadcrumb,
      icon: capability.icon,
      keywords: [...capability.aliases, capability.description, ...capability.breadcrumb],
      requiresQuery: capability.requiresQuery,
      org: capability.org,
      run: () => {
        close();
        executeCapabilityTarget(capability.target, executor);
      },
    }));
  }, [
    activeOrgId,
    canManage,
    close,
    cycle,
    density,
    initiative,
    onOpenPanel,
    openCreate,
    orgName,
    orgs,
    panelsAvailable,
    program,
    project,
    queryClient,
    authentication,
    sessionOwnerUserId,
    router,
    setDensity,
    task,
    team,
  ]);
}
