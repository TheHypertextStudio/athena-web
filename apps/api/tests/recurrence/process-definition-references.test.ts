/** Workspace reference checks for prepared process definitions. */
import { milestone, project, team } from '@docket/db';
import { getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { ConflictError, NotFoundError } from '../../src/error';
import { validateProcessDefinitionReferences } from '../../src/lib/recurrence/process-definition';
import type { PreparedProcessDefinition } from '../../src/lib/recurrence/task-template-identity';
import { routedQueryFake } from './recurrence-query-fake';

const organizationId = '01BX5ZZKBKACTAV9WEVGEMMV10';
const teamId = '01BX5ZZKBKACTAV9WEVGEMMV14';
const otherTeamId = '01BX5ZZKBKACTAV9WEVGEMMV15';
const projectId = '01BX5ZZKBKACTAV9WEVGEMMV16';
const otherProjectId = '01BX5ZZKBKACTAV9WEVGEMMV17';
const milestoneId = '01BX5ZZKBKACTAV9WEVGEMMV18';
const table = {
  milestone: getTableName(milestone),
  project: getTableName(project),
  team: getTableName(team),
} as const;
const openTeam = { id: teamId, workflowStates: [{ key: 'todo', type: 'unstarted' }] };

function prepared(tasks: readonly Record<string, unknown>[]): PreparedProcessDefinition {
  return {
    name: 'Launch',
    creationMode: 'all_at_once',
    milestones: [],
    dependencies: [],
    tasks: tasks.map((step) => ({ key: 'step', title: 'Step', teamId, labelIds: [], ...step })),
  } as unknown as PreparedProcessDefinition;
}

describe('validateProcessDefinitionReferences', () => {
  it('refuses a task whose team resolved to a different row', async () => {
    const fake = routedQueryFake({ [table.team]: [{ ...openTeam, id: otherTeamId }] });
    await expect(
      validateProcessDefinitionReferences(fake.transaction, organizationId, prepared([{}])),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses a fixed milestone outside the fixed project', async () => {
    const fake = routedQueryFake({
      [table.team]: [openTeam],
      [table.project]: [{ id: projectId }],
      [table.milestone]: [{ id: milestoneId, projectId: otherProjectId }],
    });
    await expect(
      validateProcessDefinitionReferences(
        fake.transaction,
        organizationId,
        prepared([{ projectId, milestoneId }]),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('accepts a fixed milestone inside the fixed project', async () => {
    const fake = routedQueryFake({
      [table.team]: [openTeam],
      [table.project]: [{ id: projectId }],
      [table.milestone]: [{ id: milestoneId, projectId }],
    });
    await expect(
      validateProcessDefinitionReferences(
        fake.transaction,
        organizationId,
        prepared([{ projectId, milestoneId }]),
      ),
    ).resolves.toBeUndefined();
  });
});
