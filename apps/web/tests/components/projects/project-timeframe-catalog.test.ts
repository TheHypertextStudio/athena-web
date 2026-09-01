import { ProjectOut, type ProjectOut as Project } from '../../../src/lib/contracts/project';
import { describe, expect, it } from 'vitest';

import {
  buildProjectCatalog,
  formatProjectTarget,
  targetTimeframeKey,
} from '../../../src/components/projects/project-catalog';
import { formatProjectTimelineSpan } from '../../../src/components/projects/project-timeline-catalog';
import { findField, optionsFor } from '../../../src/components/views/field-catalog';
import { assertDefined } from '@docket/test-utils';

/** Unbranded fixture input parsed through the public Project schema. */
type ProjectFixtureOverrides = Partial<Omit<Project, 'id' | 'organizationId'>> & {
  readonly id?: string;
  readonly organizationId?: string;
};

/** Construct one valid Project with planning metadata overrides. */
function project(overrides: ProjectFixtureOverrides): Project {
  return ProjectOut.parse({
    id: 'PR0JECT0000000000000000001',
    organizationId: '0RG00000000000000000000001',
    name: 'Launch',
    status: 'planned',
    priority: 'none',
    teamId: null,
    startDate: null,
    startDateResolution: null,
    startDateFiscalYearStartMonth: null,
    targetDate: null,
    targetDateResolution: null,
    targetDateFiscalYearStartMonth: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });
}

const MONTH_PROJECT = project({
  id: 'PR0JECT0000000000000000002',
  targetDate: '2026-06-30',
  targetDateResolution: 'month',
  targetDateFiscalYearStartMonth: 0,
});

const EXACT_PROJECT = project({
  id: 'PR0JECT0000000000000000003',
  targetDate: '2026-06-17',
});

describe('Project planning timeframe catalog', () => {
  it('formats semantic targets and keys exact days separately', () => {
    expect(formatProjectTarget(MONTH_PROJECT)).toBe('June 2026');
    expect(targetTimeframeKey(MONTH_PROJECT)).toBe('2026-06-30|month|0');
    expect(formatProjectTarget(EXACT_PROJECT)).toBe('Jun 17, 2026');
    expect(targetTimeframeKey(EXACT_PROJECT)).toBe('2026-06-17|day');
  });

  it('offers only loaded target timeframes for filtering and grouping', () => {
    const projects = [MONTH_PROJECT, EXACT_PROJECT, project({ id: 'PR0JECT0000000000000000004' })];
    const catalog = buildProjectCatalog({
      projects,
      statuses: [],
      leadLabel: 'Lead',
      teamLabel: 'Team',
      leadOptions: () => [],
      resolveLead: (id) => id,
      teamOptions: () => [],
      resolveTeam: (id) => id,
    });
    const timeframe = assertDefined(findField(catalog, 'targetTimeframe'));

    expect(timeframe.groupable).toBe(true);
    expect(timeframe.accessor(MONTH_PROJECT)).toBe('2026-06-30|month|0');
    expect(optionsFor(timeframe)).toEqual([
      { value: '2026-06-17|day', label: 'Jun 17, 2026' },
      { value: '2026-06-30|month|0', label: 'June 2026' },
    ]);
  });

  it('describes timeline geometry with semantic span labels', () => {
    const row = {
      ...MONTH_PROJECT,
      startDate: '2026-04-01',
      startDateResolution: 'quarter' as const,
      startDateFiscalYearStartMonth: 3,
      labelIds: [],
      initiativeIds: [],
      display: {
        subjectType: 'project' as const,
        subjectId: MONTH_PROJECT.id,
        iconKey: 'folder' as const,
        colorKey: 'neutral' as const,
        customColor: null,
        coverImage: null,
        customized: false,
      },
      milestones: [],
      taskCount: 0,
      completedTaskCount: 0,
      blockedByIds: [],
      blocksIds: [],
    };
    expect(formatProjectTimelineSpan(row)).toBe('Q1 FY 2027 to June 2026');
  });
});
