import { beforeAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';

import type * as DbModule from '@docket/db';
import { ActorId } from '@docket/identity-access/ids';
import { TaskWorkViewQueryRequest } from '@docket/work/work-view-contract';

import { queryWorkView } from '../../src/lib/work-views/query';
import { getDb, seedBaseOrg } from '../support/routes-harness';

type TaskRequest = z.output<typeof TaskWorkViewQueryRequest>;

function taskRequest(over: Partial<TaskRequest> = {}): TaskRequest {
  return TaskWorkViewQueryRequest.parse({
    target: 'task',
    definition: {
      version: 2,
      target: 'task',
      filter: null,
      arrangement: { groupBy: null, subGroupBy: null, orderBy: [] },
      presentation: {
        layout: 'list',
        properties: ['status', 'priority'],
        density: 'comfortable',
        showEmptyGroups: false,
      },
    },
    temporaryFilter: null,
    context: { kind: 'organization' },
    limit: 100,
    ...over,
  });
}

function withTaskFilter(filter: NonNullable<TaskRequest['definition']['filter']>): TaskRequest {
  return taskRequest({
    definition: { ...taskRequest().definition, filter },
  });
}

describe('historical person filters', () => {
  let schema: typeof DbModule;
  beforeAll(async () => {
    schema = await getDb();
  });
  it('keeps saved assignee filters working after person consolidation', async () => {
    const root = await seedBaseOrg(schema.db, schema);
    const [oldPerson] = await schema.db
      .insert(schema.actor)
      .values({
        organizationId: root.orgId,
        kind: 'human',
        displayName: 'Former ID',
        archivedAt: new Date(),
      })
      .returning();
    if (!oldPerson) throw new Error('person was not seeded');
    await schema.db.insert(schema.actorAlias).values({
      organizationId: root.orgId,
      actorId: oldPerson.id,
      canonicalActorId: root.humanActorId,
      mergedBy: root.humanActorId,
    });
    await schema.db
      .insert(schema.task)
      .values({
        organizationId: root.orgId,
        teamId: root.teamId,
        title: 'Merged assignment',
        state: 'todo',
        statusId: root.statusId('task', 'todo'),
        assigneeId: oldPerson.id,
        visibility: 'public',
      })
      .returning();
    for (const operator of ['is', 'isAnyOf'] as const) {
      const operand = { kind: 'actor' as const, actorId: ActorId.parse(oldPerson.id) };
      const request = withTaskFilter(
        operator === 'is'
          ? { kind: 'predicate', field: 'assignee', operator, operand }
          : { kind: 'predicate', field: 'assignee', operator, operand: [operand] },
      );
      const result = await queryWorkView({
        database: schema.db,
        organizationId: root.orgId,
        actorId: root.humanActorId,
        request,
      });
      expect(result.totalCount).toBe(1);
    }
  });
});
