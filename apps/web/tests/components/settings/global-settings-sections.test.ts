import { describe, expect, it } from 'vitest';

import {
  GLOBAL_SETTINGS_SECTIONS,
  globalSettingsSectionHref,
} from '../../../src/components/settings/global-sections';

describe('global settings sections', () => {
  it('orders settings around the user-owned assistant', () => {
    expect(GLOBAL_SETTINGS_SECTIONS.map((section) => section.key)).toEqual([
      'profile',
      'athena',
      'connections',
      'notifications',
      'calendar',
      'security',
      'connected-apps',
      'data-privacy',
      'workspaces',
    ]);
  });

  it('keeps outbound data sources distinct from inbound app access', () => {
    const connections = GLOBAL_SETTINGS_SECTIONS.find((section) => section.key === 'connections');
    const connectedApps = GLOBAL_SETTINGS_SECTIONS.find(
      (section) => section.key === 'connected-apps',
    );

    expect(connections?.label).toBe('Connections');
    expect(connections?.description).toContain('Athena uses');
    expect(connectedApps?.label).toBe('Connected apps');
    expect(connectedApps?.description).toContain('access Docket');
  });

  it('builds global settings routes without an organization id', () => {
    expect(globalSettingsSectionHref('connections')).toBe('/settings/connections');
  });
});
