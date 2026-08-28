import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { queryWorkView } from '../../src/lib/work-views/query';
import { projectRequest } from './request-fixtures';
import { getDb, seedBaseOrg } from '../support/routes-harness';

describe('Project work-view planning timeframes', () => {
  let schema: typeof DbModule;

  beforeAll(async () => {
    schema = await getDb();
  });

  it('projects and groups a saved target by its semantic fiscal timeframe', async () => {
    const org = await seedBaseOrg(schema.db, schema);
    await schema.db.insert(schema.project).values([
      {
        organizationId: org.orgId,
        name: 'Exact launch',
        teamId: org.teamId,
        status: 'planned',
        statusId: org.statusId('project', 'planned'),
        targetDate: new Date('2027-06-17T00:00:00.000Z'),
      },
      {
        organizationId: org.orgId,
        name: 'Launch month',
        teamId: org.teamId,
        status: 'planned',
        statusId: org.statusId('project', 'planned'),
        targetDate: new Date('2027-06-30T00:00:00.000Z'),
        targetDateResolution: 'month',
        targetDateFiscalYearStartMonth: 0,
      },
      {
        organizationId: org.orgId,
        name: 'Launch quarter',
        teamId: org.teamId,
        status: 'planned',
        statusId: org.statusId('project', 'planned'),
        targetDate: new Date('2026-09-30T00:00:00.000Z'),
        targetDateResolution: 'quarter',
        targetDateFiscalYearStartMonth: 6,
      },
      {
        organizationId: org.orgId,
        name: 'Launch half',
        teamId: org.teamId,
        status: 'planned',
        statusId: org.statusId('project', 'planned'),
        targetDate: new Date('2027-06-30T00:00:00.000Z'),
        targetDateResolution: 'halfYear',
        targetDateFiscalYearStartMonth: 6,
      },
      {
        organizationId: org.orgId,
        name: 'Launch fiscal year',
        teamId: org.teamId,
        status: 'planned',
        statusId: org.statusId('project', 'planned'),
        targetDate: new Date('2027-06-30T00:00:00.000Z'),
        targetDateResolution: 'year',
        targetDateFiscalYearStartMonth: 6,
      },
      {
        organizationId: org.orgId,
        name: 'Launch calendar year',
        teamId: org.teamId,
        status: 'planned',
        statusId: org.statusId('project', 'planned'),
        targetDate: new Date('2027-12-31T00:00:00.000Z'),
        targetDateResolution: 'year',
        targetDateFiscalYearStartMonth: 0,
      },
    ]);

    const ungrouped = await queryWorkView({
      database: schema.db,
      organizationId: org.orgId,
      actorId: org.humanActorId,
      request: projectRequest(),
    });
    const projectRows = ungrouped.rows.filter(
      (row): row is Extract<(typeof ungrouped.rows)[number], { readonly target: 'project' }> =>
        row.target === 'project',
    );
    expect(
      Object.fromEntries(projectRows.map((row) => [row.name, row.targetTimeframe] as const)),
    ).toEqual({
      'Exact launch': { key: '2027-06-17|day', label: 'Jun 17, 2027' },
      'Launch month': { key: '2027-06-30|month|0', label: 'June 2027' },
      'Launch quarter': { key: '2026-09-30|quarter|6', label: 'Q1 FY 2027' },
      'Launch half': { key: '2027-06-30|halfYear|6', label: 'H2 FY 2027' },
      'Launch fiscal year': { key: '2027-06-30|year|6', label: 'FY 2027' },
      'Launch calendar year': { key: '2027-12-31|year|0', label: '2027' },
    });

    const grouped = await queryWorkView({
      database: schema.db,
      organizationId: org.orgId,
      actorId: org.humanActorId,
      request: projectRequest({
        definition: {
          ...projectRequest().definition,
          arrangement: { groupBy: 'targetTimeframe', subGroupBy: null, orderBy: [] },
        },
      }),
    });
    expect(grouped.groups).toContainEqual({
      path: ['2027-06-30|halfYear|6'],
      key: '2027-06-30|halfYear|6',
      label: 'H2 FY 2027',
      count: 1,
    });
  });
});
