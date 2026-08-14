/**
 * Unit tests for the unified Settings registry.
 *
 * @remarks
 * Replaces `global-settings-sections.test.ts` and `settings-sections.test.ts`, which pinned the
 * three-registry split (`global-sections.ts`, `sections.ts`, `sections-personal.ts`) this registry
 * replaces. These tests pin the merged contract instead:
 *
 * - the Personal group is workspace-independent and carries every person-level concern, including
 *   the three that used to be split across a personal-workspace-only corner of the org tree
 *   (Connected accounts, Notifications, Calendar) and the two duplicated there outright (Security,
 *   Connected apps);
 * - a personal workspace's Workspace groups omit Members & Access, Publishing, and Connections
 *   (already covered by the Personal group's own Connections);
 * - a shared org's Workspace groups keep the full administrative set;
 * - the retired vocabulary picker and the folded-into-Data-&-privacy Export/Danger zone routes
 *   never resurface as registry entries.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PERSONAL_SETTINGS_SECTION,
  DEFAULT_WORKSPACE_SETTINGS_SECTION,
  defaultSettingsSection,
  PERSONAL_SETTINGS_GROUP,
  PERSONAL_SETTINGS_SECTIONS,
  PERSONAL_WORKSPACE_SETTINGS_SECTION_GROUPS,
  personalSectionHref,
  sectionHref,
  SETTINGS_SECTIONS,
  type SettingsSection,
  WORKSPACE_SETTINGS_SECTION_GROUPS,
  workspaceSettingsSectionGroups,
  workspaceSettingsSections,
} from '../../../src/components/settings/settings-registry';

describe('Personal group', () => {
  const keys = PERSONAL_SETTINGS_SECTIONS.map((section) => section.key);

  it('is ordered around the user-owned assistant, per mvp-plan §8.7', () => {
    expect(keys).toEqual([
      'profile',
      'athena',
      'connections',
      'connected-accounts',
      'connected-apps',
      'notifications',
      'calendar',
      'work-locations',
      'security',
      'data-privacy',
    ]);
  });

  it('has no separate "Workspaces" bridge entry — the switcher chip replaces it', () => {
    expect(keys).not.toContain('workspaces');
  });

  it('has no separate automations entry — automations is workspace-only', () => {
    expect(keys).not.toContain('automations');
  });

  it('has no separate Export/Danger zone entries — both live inside Data & privacy', () => {
    expect(keys).not.toContain('export');
    expect(keys).not.toContain('danger');
  });

  it('keeps three distinct connectivity concerns: outbound, identity, inbound', () => {
    const connections = PERSONAL_SETTINGS_SECTIONS.find((s) => s.key === 'connections');
    const connectedAccounts = PERSONAL_SETTINGS_SECTIONS.find(
      (s) => s.key === 'connected-accounts',
    );
    const connectedApps = PERSONAL_SETTINGS_SECTIONS.find((s) => s.key === 'connected-apps');

    expect(connections?.description).toContain('Athena uses');
    expect(connectedAccounts?.description).toContain('linked');
    expect(connectedApps?.description).toContain('access Docket');
  });

  it('gives every section a stable key, label, href, and icon', () => {
    for (const section of PERSONAL_SETTINGS_SECTIONS) {
      expect(section.key).toBeTruthy();
      expect(section.label).toBeTruthy();
      expect(section.href).toBeTruthy();
      expect(section.icon).toBeTruthy();
    }
  });

  it('exposes itself as a single labelled group, for the unified nav', () => {
    expect(PERSONAL_SETTINGS_GROUP.label).toBe('Personal');
    expect(PERSONAL_SETTINGS_GROUP.sections).toBe(PERSONAL_SETTINGS_SECTIONS);
  });
});

describe('personalSectionHref', () => {
  it('builds a route with no organization id', () => {
    expect(personalSectionHref('connections')).toBe('/settings/connections');
    expect(personalSectionHref(DEFAULT_PERSONAL_SETTINGS_SECTION)).toBe('/settings/profile');
  });
});

describe('workspaceSettingsSectionGroups', () => {
  it('returns the full shared-org registry for a shared workspace', () => {
    expect(workspaceSettingsSectionGroups(false)).toBe(WORKSPACE_SETTINGS_SECTION_GROUPS);
  });

  it('returns the reduced registry for a personal workspace', () => {
    expect(workspaceSettingsSectionGroups(true)).toBe(PERSONAL_WORKSPACE_SETTINGS_SECTION_GROUPS);
  });
});

describe('shared workspace sections', () => {
  const orgSections = workspaceSettingsSections(false);

  it('leads with editable workspace basics', () => {
    expect(orgSections.map((section) => section.key)).toEqual([
      'general',
      'members',
      'statuses',
      'work-structure',
      'labels',
      'templates',
      'import',
      'automations',
      'connections',
      'publishing',
    ]);
  });

  it('matches the flattened group sections exactly', () => {
    const flattened = WORKSPACE_SETTINGS_SECTION_GROUPS.flatMap(
      (g): readonly SettingsSection[] => g.sections,
    );
    expect(orgSections).toEqual(flattened);
    expect(orgSections).toEqual(SETTINGS_SECTIONS);
  });

  it('gates Publishing on management, and only Publishing', () => {
    const gated = orgSections.filter((section) => section.requiresManage === true);
    expect(gated.map((section) => section.key)).toEqual(['publishing']);
  });

  it('does not expose the retired vocabulary picker or unfinished destinations', () => {
    const keys = orgSections.map((section) => section.key);
    expect(keys).not.toContain('vocabulary');
    expect(keys).not.toEqual(expect.arrayContaining(['teams', 'roles', 'billing', 'agents']));
  });
});

describe('personal workspace sections', () => {
  const keys = workspaceSettingsSections(true).map((section) => section.key);

  it('omits Members & Access — there is no roster to manage', () => {
    expect(keys).not.toContain('members');
  });

  it('omits the whole Advanced group — there is nothing to publish', () => {
    expect(keys).not.toContain('publishing');
  });

  it('omits Connections — already covered by the Personal group above', () => {
    expect(keys).not.toContain('connections');
  });

  it('keeps the rest of the shared work-configuration set', () => {
    expect(keys).toEqual([
      'general',
      'statuses',
      'work-structure',
      'labels',
      'templates',
      'import',
      'automations',
    ]);
  });
});

describe('defaultSettingsSection', () => {
  it('routes both workspace kinds to General, never Members', () => {
    expect(defaultSettingsSection(false)).toBe(DEFAULT_WORKSPACE_SETTINGS_SECTION);
    expect(defaultSettingsSection(true)).toBe(DEFAULT_WORKSPACE_SETTINGS_SECTION);
    expect(defaultSettingsSection(true)).toBe('general');
  });
});

describe('sectionHref', () => {
  it('builds the absolute org-scoped settings route for a section suffix', () => {
    expect(sectionHref('org_123', 'members')).toBe('/orgs/org_123/settings/members');
    expect(sectionHref('org_123', DEFAULT_WORKSPACE_SETTINGS_SECTION)).toBe(
      '/orgs/org_123/settings/general',
    );
  });
});
