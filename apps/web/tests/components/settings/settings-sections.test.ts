/**
 * Unit tests for the Settings information-architecture gate.
 *
 * @remarks
 * The Settings IA is gated on whether the active workspace is the caller's **personal** space —
 * an organization-of-one that is purely an engineering practicality and must never read as "an
 * organization" in the UX. These tests pin that contract independent of the React tree:
 *
 * - a personal workspace never sees the org/multi-tenant sections (Members & Access, Teams,
 *   Roles & Permissions) nor org-as-company Billing, and its default landing section is an
 *   *available* personal section (not the org-only `members`);
 * - a shared org keeps the full, unchanged org registry.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SETTINGS_SECTION,
  defaultSettingsSection,
  PERSONAL_SETTINGS_SECTION_GROUPS,
  SETTINGS_SECTION_GROUPS,
  sectionHref,
  type SettingsSection,
  settingsSectionGroups,
  settingsSections,
} from '../../../src/components/settings/sections';

/** The org/multi-tenant section keys that must never surface in a personal workspace. */
const ORG_ONLY_SECTION_KEYS = ['members', 'teams', 'roles', 'billing'] as const;

describe('settingsSectionGroups', () => {
  it('returns the full, unchanged org registry for a shared org', () => {
    expect(settingsSectionGroups(false)).toBe(SETTINGS_SECTION_GROUPS);
  });

  it('returns the personal registry for a personal workspace', () => {
    expect(settingsSectionGroups(true)).toBe(PERSONAL_SETTINGS_SECTION_GROUPS);
  });

  it('keeps the org registry distinct from the personal registry', () => {
    expect(settingsSectionGroups(true)).not.toBe(settingsSectionGroups(false));
  });
});

describe('personal workspace sections', () => {
  const personalKeys = settingsSections(true).map((s) => s.key);

  it('omits every org/multi-tenant section', () => {
    for (const key of ORG_ONLY_SECTION_KEYS) {
      expect(personalKeys).not.toContain(key);
    }
  });

  it('has no "Organization" group and no org-as-company framing', () => {
    const groupLabels = settingsSectionGroups(true).map((g) => g.label);
    expect(groupLabels).not.toContain('Organization');
    const everyLabel = [
      ...groupLabels,
      ...settingsSections(true).map((s) => `${s.label} ${s.description}`),
    ]
      .join(' ')
      .toLowerCase();
    expect(everyLabel).not.toContain('organization');
  });

  it('keeps workspace setup sections without the retired Language picker', () => {
    expect(personalKeys).not.toContain('vocabulary');
    expect(personalKeys).toContain('import');
    expect(personalKeys).toContain('work-structure');
  });

  it('does not place caller-owned settings under a personal workspace', () => {
    for (const key of ['connections', 'notifications', 'calendar', 'security', 'danger']) {
      expect(personalKeys).not.toContain(key);
    }
  });

  it('gives every section a stable key, label, href, and icon', () => {
    for (const section of settingsSections(true)) {
      expect(section.key).toBeTruthy();
      expect(section.label).toBeTruthy();
      expect(section.href).toBeTruthy();
      expect(section.icon).toBeTruthy();
    }
  });
});

describe('shared org sections (no regression)', () => {
  const orgSections = settingsSections(false);

  it('still includes Members & Access as an available section', () => {
    const members = orgSections.find((s) => s.key === 'members');
    expect(members?.status).toBe('available');
  });

  it('still includes the Organization and Workspace groups', () => {
    const groupLabels = settingsSectionGroups(false).map((g) => g.label);
    expect(groupLabels).toEqual(['Organization', 'Workspace']);
  });

  it('still includes every org/multi-tenant section', () => {
    const keys = orgSections.map((s) => s.key);
    for (const key of ORG_ONLY_SECTION_KEYS) {
      expect(keys).toContain(key);
    }
  });

  it('matches settingsSections(false) to the flattened group sections', () => {
    const flattened = SETTINGS_SECTION_GROUPS.flatMap(
      (g): readonly SettingsSection[] => g.sections,
    );
    expect(orgSections).toEqual(flattened);
  });

  it('does not place caller-owned notifications under a shared workspace', () => {
    expect(orgSections.map((section) => section.key)).not.toContain('notifications');
    expect(orgSections.map((section) => section.key)).not.toContain('connections');
  });

  it('does not expose the retired vocabulary picker', () => {
    expect(orgSections.map((section) => section.key)).not.toContain('vocabulary');
  });
});

describe('defaultSettingsSection', () => {
  it('routes a shared org to Members & Access', () => {
    expect(defaultSettingsSection(false)).toBe(DEFAULT_SETTINGS_SECTION);
    expect(defaultSettingsSection(false)).toBe('members');
  });

  it('routes a personal workspace to an AVAILABLE personal section (never members)', () => {
    const personalDefault = defaultSettingsSection(true);
    expect(personalDefault).not.toBe('members');

    const target = settingsSections(true).find((s) => s.href === personalDefault);
    expect(target).toBeDefined();
    expect(target?.status).toBe('available');
  });
});

describe('sectionHref', () => {
  it('builds the absolute org-scoped settings route for a section suffix', () => {
    expect(sectionHref('org_123', 'members')).toBe('/orgs/org_123/settings/members');
    expect(sectionHref('org_123', defaultSettingsSection(true))).toBe(
      '/orgs/org_123/settings/work-structure',
    );
  });
});
