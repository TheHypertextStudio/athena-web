import { describe, expect, it } from 'vitest';

import {
  RAIL_DESTINATION_IDS,
  resolveNavigationCatalog,
  selectRailDestinations,
} from '../../../src/components/shell/navigation-catalog';

describe('navigation catalog', () => {
  it('keeps the daily rail in its fixed product order', () => {
    expect(RAIL_DESTINATION_IDS).toEqual([
      'home:today',
      'workspace:my-work',
      'home:calendar',
      'home:inbox',
      'home:search',
      'home:athena',
    ]);
  });

  it('keeps secondary destinations in the full catalog', () => {
    const catalog = resolveNavigationCatalog({
      activeHomeKey: 'today',
      activeWorkspaceKey: 'projects',
      activeOrgId: 'ORG00000000000000000000001',
      personalWorkspace: false,
      vocabulary: {
        initiatives: 'Initiatives',
        programs: 'Programs',
        projects: 'Projects',
        cycles: 'Cycles',
        teams: 'Teams',
      },
    });

    expect(catalog.filter((destination) => !destination.rail).map(({ id }) => id)).toContain(
      'workspace:projects',
    );
    expect(catalog.find((destination) => destination.id === 'workspace:projects')).toMatchObject({
      active: true,
      label: 'Projects',
    });
  });

  it('selects rail destinations in the product order rather than sidebar order', () => {
    const catalog = resolveNavigationCatalog({
      activeOrgId: 'ORG00000000000000000000001',
      personalWorkspace: false,
      vocabulary: {
        initiatives: 'Initiatives',
        programs: 'Programs',
        projects: 'Projects',
        cycles: 'Cycles',
        teams: 'Teams',
      },
    });

    expect(selectRailDestinations(catalog).map(({ id }) => id)).toEqual(RAIL_DESTINATION_IDS);
  });

  it('removes shared-workspace destinations from the personal catalog', () => {
    const catalog = resolveNavigationCatalog({
      activeOrgId: 'ORG00000000000000000000001',
      personalWorkspace: true,
      vocabulary: {
        initiatives: 'Initiatives',
        programs: 'Programs',
        projects: 'Projects',
        cycles: 'Cycles',
        teams: 'Teams',
      },
    });

    expect(catalog.map(({ id }) => id)).not.toContain('workspace:teams');
    expect(catalog.map(({ id }) => id)).not.toContain('workspace:people');
  });

  it('keeps workspace labels but disables them until context resolves', () => {
    const catalog = resolveNavigationCatalog({
      activeOrgId: null,
      personalWorkspace: false,
      vocabulary: {
        initiatives: 'Initiatives',
        programs: 'Programs',
        projects: 'Projects',
        cycles: 'Cycles',
        teams: 'Teams',
      },
    });

    expect(catalog.find((destination) => destination.id === 'workspace:projects')).toMatchObject({
      label: 'Projects',
      disabled: true,
    });
  });
});
