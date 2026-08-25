import { describe, expect, it } from 'vitest';

import {
  resolveCapabilities,
  validateCapabilityCatalog,
  type AppCapability,
  type CapabilityContext,
} from '@/components/app-catalog';
import {
  ACTION_CAPABILITIES,
  HOME_CAPABILITIES,
  PANEL_CAPABILITIES,
  WORKSPACE_CAPABILITIES,
} from '@/components/app-catalog/shell-capabilities';
import { SETTINGS_CAPABILITIES } from '@/components/settings/settings-capabilities';

const SHARED_CONTEXT: CapabilityContext = {
  activeOrgId: 'org_123',
  activeOrgName: 'Acme',
  activeOrgIsPersonal: false,
  canManageActiveOrg: true,
  panelsAvailable: true,
  vocabulary: {
    task: 'Tasks',
    initiative: 'Initiatives',
    program: 'Programs',
    project: 'Projects',
    cycle: 'Cycles',
    team: 'Teams',
  },
};

describe('capability catalog integrity', () => {
  it('has unique ids, descriptions, and valid targets', () => {
    expect(() => {
      validateCapabilityCatalog([
        ...HOME_CAPABILITIES,
        ...ACTION_CAPABILITIES,
        ...WORKSPACE_CAPABILITIES,
        ...PANEL_CAPABILITIES,
        ...SETTINGS_CAPABILITIES,
      ]);
    }).not.toThrow();
  });

  it('catalogs every existing global action', () => {
    expect(ACTION_CAPABILITIES.map((entry) => entry.id)).toEqual([
      'action:new:task',
      'action:new:project',
      'action:new:initiative',
      'action:new:program',
      'action:new-org',
      'action:density',
      'action:sign-out',
    ]);
  });

  it('covers every shipped Home and workspace destination', () => {
    expect(HOME_CAPABILITIES.map((entry) => entry.id)).toEqual([
      'home:today',
      'home:tasks',
      'home:calendar',
      'home:time',
      'home:inbox',
      'home:athena',
      'home:stream',
      'home:portfolio',
    ]);
    expect(WORKSPACE_CAPABILITIES.map((entry) => entry.id)).toEqual([
      'workspace:my-work',
      'workspace:triage',
      'workspace:tasks',
      'workspace:stream',
      'workspace:library',
      'workspace:initiatives',
      'workspace:programs',
      'workspace:projects',
      'workspace:cycles',
      'workspace:teams',
      'workspace:people',
      'workspace:views',
      'workspace:graph',
      'workspace:settings',
    ]);
  });

  it('covers stable nested Settings destinations and groups', () => {
    const ids = SETTINGS_CAPABILITIES.map((entry) => entry.id);

    expect(ids).toContain('settings:personal:connections:google-calendar');
    expect(ids).toContain('settings:workspace:connections:notion');
    expect(ids).toContain('settings:workspace:connections:notion-people');
    expect(ids).toContain('settings:node:passkeys');
  });
});

describe('resolveCapabilities', () => {
  it('uses the current workspace for Hub-scoped workspace settings', () => {
    const resolved = resolveCapabilities(SETTINGS_CAPABILITIES, SHARED_CONTEXT);
    const statuses = resolved.find((entry) => entry.id === 'settings:workspace:statuses');

    expect(statuses?.target).toEqual({
      type: 'route',
      href: '/orgs/org_123/settings/statuses',
    });
    expect(statuses?.org).toEqual({ id: 'org_123', name: 'Acme' });
  });

  it('removes management, shared-workspace, and panel capabilities when unavailable', () => {
    const restricted: CapabilityContext = {
      ...SHARED_CONTEXT,
      activeOrgIsPersonal: true,
      canManageActiveOrg: false,
      panelsAvailable: false,
    };
    const catalog: readonly AppCapability[] = [...SETTINGS_CAPABILITIES, ...PANEL_CAPABILITIES];
    const ids = resolveCapabilities(catalog, restricted).map((entry) => entry.id);

    expect(ids).not.toContain('settings:workspace:members');
    expect(ids).not.toContain('settings:workspace:publishing');
    expect(ids).not.toContain('panel:agenda');
    expect(ids).toContain('settings:personal:security');
  });
});
