/**
 * The names and states a card is sent for the things it points at: an update's subject, and the
 * people, projects, and cycles an `update` moved something between.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import { assertDefined } from '@docket/test-utils';

import type { changeRenderOf as ChangeRenderOf } from '../../src/mcp/apps/change-render';
import type { subjectRefOf as SubjectRefOf } from '../../src/mcp/hydrated-refs';
import type { ChangeRecord } from '../../src/mcp/change-set';
import { getMigratedDb } from '../support/db';
import { seedInitiative, seedProgram } from '../support/routes-harness';
import {
  seedMcpUpdateOrg,
  seedMcpUpdateTask,
  type McpUpdateSeed,
} from './mcp-update-tool-fixtures';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let subjectRefOf!: typeof SubjectRefOf;
let changeRenderOf!: typeof ChangeRenderOf;

beforeAll(async () => {
  schema = await getMigratedDb();
  db = schema.db;
  subjectRefOf = (await import('../../src/mcp/hydrated-refs')).subjectRefOf;
  changeRenderOf = (await import('../../src/mcp/apps/change-render')).changeRenderOf;
});

async function insertId(query: Promise<{ id: string }[]>): Promise<string> {
  return assertDefined((await query)[0]).id;
}

async function seedContainers(s: McpUpdateSeed) {
  const program = await seedProgram(db, schema, s.statusId, {
    organizationId: s.orgId,
    name: 'Community access',
    createdBy: s.actorId,
  });
  const initiative = await seedInitiative(db, schema, s.statusId, {
    organizationId: s.orgId,
    name: 'Transit access',
    createdBy: s.actorId,
  });
  const programId = program.id;
  const initiativeId = initiative.id;
  const cycleId = await insertId(
    db
      .insert(schema.cycle)
      .values({
        organizationId: s.orgId,
        teamId: s.teamId,
        number: 9001,
        startsAt: new Date('2031-03-02T00:00:00Z'),
        endsAt: new Date('2031-03-09T00:00:00Z'),
      })
      .returning({ id: schema.cycle.id }),
  );
  const milestoneId = await insertId(
    db
      .insert(schema.milestone)
      .values({ organizationId: s.orgId, projectId: s.projectId, name: 'Campaign week' })
      .returning({ id: schema.milestone.id }),
  );
  return { programId, initiativeId, cycleId, milestoneId };
}

describe('subjectRefOf', () => {
  it('names every kind of subject and routes to it', async () => {
    const s = await seedMcpUpdateOrg(db, schema, ['contribute']);
    const { programId, initiativeId, cycleId } = await seedContainers(s);
    const taskId = await seedMcpUpdateTask(db, schema, s, { title: 'Book the hosts' });

    expect(await subjectRefOf(s.orgId, 'project', s.projectId)).toMatchObject({
      name: 'Platform Migration',
      href: expect.stringContaining('/projects/'),
    });
    expect(await subjectRefOf(s.orgId, 'program', programId)).toMatchObject({
      name: 'Community access',
      href: expect.stringContaining('/programs/'),
    });
    expect(await subjectRefOf(s.orgId, 'initiative', initiativeId)).toMatchObject({
      name: 'Transit access',
      href: expect.stringContaining('/initiatives/'),
    });
    expect(await subjectRefOf(s.orgId, 'task', taskId)).toMatchObject({
      name: 'Book the hosts',
      href: expect.stringContaining('/tasks/'),
    });
    const cycle = await subjectRefOf(s.orgId, 'cycle', cycleId);
    expect(cycle.name).toEqual(expect.any(String));
    expect(cycle.href).toEqual(expect.stringContaining('/cycles/'));
  });

  it('names nothing and links nowhere for a subject that is gone or has no page', async () => {
    const s = await seedMcpUpdateOrg(db, schema, ['contribute']);
    expect(await subjectRefOf(s.orgId, 'project', 'missing')).toEqual({
      type: 'project',
      id: 'missing',
      name: null,
      href: null,
    });
    expect(await subjectRefOf(s.orgId, 'cycle', 'missing')).toMatchObject({
      name: null,
      href: null,
    });
    expect(await subjectRefOf(s.orgId, 'calendar_event', 'e_1')).toMatchObject({
      name: null,
      href: null,
    });
  });
});

describe('changeRenderOf', () => {
  it('names every kind of reference a field can move between', async () => {
    const s = await seedMcpUpdateOrg(db, schema, ['contribute']);
    const { programId, cycleId, milestoneId } = await seedContainers(s);
    const parentId = await seedMcpUpdateTask(db, schema, s, { title: 'Parent task' });
    const record: ChangeRecord = {
      kind: 'task',
      id: 't_1',
      op: 'update',
      before: {
        teamId: s.teamId,
        delegateId: null,
        projectId: null,
        programId: null,
        milestoneId: null,
        cycleId: null,
        parentTaskId: null,
      },
      after: {
        teamId: s.teamId,
        delegateId: s.sarahId,
        projectId: s.projectId,
        programId,
        milestoneId,
        cycleId,
        parentTaskId: parentId,
      },
    };
    const fields = [
      'delegateId',
      'projectId',
      'programId',
      'milestoneId',
      'cycleId',
      'parentTaskId',
    ].map((field) => ({ field }));
    const render = await changeRenderOf(s.orgId, [{ id: 't_1', fields }], [record]);
    expect(render.changes['t_1']).toMatchObject({
      delegateId: { from: 'none', to: 'Sarah' },
      projectId: { to: 'Platform Migration' },
      programId: { to: 'Community access' },
      milestoneId: { to: 'Campaign week' },
      cycleId: { to: expect.any(String) },
      parentTaskId: { to: 'Parent task' },
    });
  });

  it('says what a reference was when the thing it named is gone', async () => {
    const s = await seedMcpUpdateOrg(db, schema, ['contribute']);
    const record: ChangeRecord = {
      kind: 'task',
      id: 't_1',
      op: 'update',
      before: { assigneeId: 'gone', teamId: 'gone_team' },
      after: { assigneeId: s.actorId, teamId: s.teamId },
    };
    const render = await changeRenderOf(
      s.orgId,
      [{ id: 't_1', fields: [{ field: 'assigneeId' }, { field: 'teamId' }] }],
      [record],
    );
    expect(render.changes['t_1']).toEqual({
      assigneeId: { from: 'Former member', to: 'Ada' },
      teamId: { from: 'Deleted team', to: 'Core' },
    });
  });

  it('leaves alone what already reads correctly, and reports a formatting-only rewrite', async () => {
    const s = await seedMcpUpdateOrg(db, schema, ['contribute']);
    const record: ChangeRecord = {
      kind: 'task',
      id: 't_1',
      op: 'update',
      before: {
        priority: 'none',
        statusId: 'a',
        state: 'nope',
        teamId: 'unknown',
        description: 'Same *words*',
      },
      after: {
        priority: 'high',
        statusId: 'b',
        state: 'also_nope',
        teamId: 'unknown',
        description: 'Same **words**',
      },
    };
    const reported = [
      {
        id: 't_1',
        fields: [{ field: 'priority' }, { field: 'statusId' }, { field: 'description' }],
      },
      { id: 't_2', fields: [{ field: 'priority' }] },
    ];
    expect((await changeRenderOf(s.orgId, reported, [record])).changes).toEqual({
      t_1: { description: { from: 'none', to: 'Formatting changed' } },
    });
    const stateOnly = await changeRenderOf(
      s.orgId,
      [{ id: 't_1', fields: [{ field: 'state' }] }],
      [record],
    );
    expect(stateOnly.changes).toEqual({});
  });
});
