import {
  HOME_NAVIGATION_DESCRIPTORS,
  WORKSPACE_NAVIGATION_DESCRIPTORS,
} from '@docket/ui/components';
import { Calendar, Layers, LogOut, Plus, Sparkles, Timer } from '@docket/ui/icons';

import type { AppCapability, CapabilityContext } from './types';

/** Existing application-wide actions expressed as declarative catalog intents. */
export const ACTION_CAPABILITIES: readonly AppCapability[] = [
  {
    id: 'action:new:task',
    kind: 'action',
    label: (context) => `New ${context.vocabulary.task.toLocaleLowerCase()}`,
    description: 'Create a task in the current workspace.',
    aliases: ['new task', 'create task', 'add issue'],
    icon: Plus,
    scope: 'workspace',
    target: { type: 'intent', intent: { type: 'create', kind: 'task' } },
    available: (context) => context.activeOrgId !== null,
  },
  {
    id: 'action:new:project',
    kind: 'action',
    label: (context) => `New ${context.vocabulary.project.toLocaleLowerCase()}`,
    description: 'Create a project in the current workspace.',
    aliases: ['new project', 'create project'],
    icon: Plus,
    scope: 'workspace',
    target: { type: 'intent', intent: { type: 'create', kind: 'project' } },
    available: (context) => context.activeOrgId !== null,
  },
  {
    id: 'action:new:initiative',
    kind: 'action',
    label: (context) => `New ${context.vocabulary.initiative.toLocaleLowerCase()}`,
    description: 'Create a strategic initiative in the current workspace.',
    aliases: ['new initiative', 'create initiative', 'new goal'],
    icon: Plus,
    scope: 'workspace',
    target: { type: 'intent', intent: { type: 'create', kind: 'initiative' } },
    available: (context) => context.activeOrgId !== null,
  },
  {
    id: 'action:new:program',
    kind: 'action',
    label: (context) => `New ${context.vocabulary.program.toLocaleLowerCase()}`,
    description: 'Create an ongoing program in the current workspace.',
    aliases: ['new program', 'create program', 'new stream'],
    icon: Plus,
    scope: 'workspace',
    target: { type: 'intent', intent: { type: 'create', kind: 'program' } },
    available: (context) => context.activeOrgId !== null,
  },
  {
    id: 'action:new-org',
    kind: 'action',
    label: 'Create workspace',
    description: 'Create another shared workspace.',
    aliases: ['new workspace', 'new organization'],
    icon: Plus,
    scope: 'global',
    target: { type: 'intent', intent: { type: 'create-workspace' } },
  },
  {
    id: 'action:density',
    kind: 'action',
    label: 'Switch display density',
    description: 'Cycle between compact, comfortable, and spacious row spacing.',
    aliases: ['compact', 'comfortable', 'spacious', 'spacing'],
    icon: Layers,
    scope: 'global',
    target: { type: 'intent', intent: { type: 'cycle-density' } },
  },
  {
    id: 'action:sign-out',
    kind: 'action',
    label: 'Sign out',
    description: 'End this Docket session on the current device.',
    aliases: ['log out', 'logout'],
    icon: LogOut,
    scope: 'global',
    target: { type: 'intent', intent: { type: 'sign-out' } },
  },
];

/** Cross-workspace destinations derived from the Sidebar's semantic descriptors. */
export const HOME_CAPABILITIES: readonly AppCapability[] = HOME_NAVIGATION_DESCRIPTORS.map(
  (descriptor) => ({
    id: `home:${descriptor.key}`,
    kind: 'destination',
    label: descriptor.label,
    description: descriptor.description,
    aliases: descriptor.aliases,
    icon: descriptor.icon,
    scope: 'global',
    target: { type: 'route', href: descriptor.href },
  }),
);

function workspaceHref(segment: string, context: CapabilityContext): string {
  return context.activeOrgId ? `/orgs/${context.activeOrgId}/${segment}` : '';
}

/** Current-workspace destinations derived from the Sidebar's semantic descriptors. */
export const WORKSPACE_CAPABILITIES: readonly AppCapability[] =
  WORKSPACE_NAVIGATION_DESCRIPTORS.map((descriptor) => ({
    id: `workspace:${descriptor.key}`,
    kind: 'destination',
    label: (context) =>
      typeof descriptor.label === 'string'
        ? descriptor.label
        : context.vocabulary[descriptor.label.vocabulary],
    description: descriptor.description,
    aliases: descriptor.aliases,
    icon: descriptor.icon,
    scope: 'workspace',
    target: {
      type: 'route',
      href: (context) => workspaceHref(descriptor.segment, context),
    },
    available: (context) =>
      context.activeOrgId !== null && (!descriptor.sharedOnly || !context.activeOrgIsPersonal),
  }));

/** Persistent utility-rail panels, available only on routes that host the rail. */
export const PANEL_CAPABILITIES: readonly AppCapability[] = [
  {
    id: 'panel:agenda',
    kind: 'panel',
    label: 'Open Agenda',
    description: 'Show today’s calendar and schedule in the utility rail.',
    aliases: ['calendar panel', 'schedule panel'],
    icon: Calendar,
    scope: 'global',
    target: { type: 'intent', intent: { type: 'open-panel', panelId: 'agenda' } },
    available: (context) => context.panelsAvailable,
  },
  {
    id: 'panel:focus',
    kind: 'panel',
    label: 'Open Focus',
    description: 'Show the focus timer in the utility rail.',
    aliases: ['timer panel', 'focus timer'],
    icon: Timer,
    scope: 'global',
    target: { type: 'intent', intent: { type: 'open-panel', panelId: 'focus' } },
    available: (context) => context.panelsAvailable,
  },
  {
    id: 'panel:athena',
    kind: 'panel',
    label: 'Open Athena panel',
    description: 'Show your Athena conversation beside the current page.',
    aliases: ['assistant panel', 'chat panel'],
    icon: Sparkles,
    scope: 'global',
    target: { type: 'intent', intent: { type: 'open-panel', panelId: 'athena' } },
    available: (context) => context.panelsAvailable,
  },
];
