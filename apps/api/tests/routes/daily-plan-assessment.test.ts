import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '@docket/db';
import type { DailyPlanSnapshot } from '@docket/planning/daily-plan-flow';
import type assessmentRouter from '../../src/routes/daily-plan-assessment';
import {
  appWithSession,
  fakeSession,
  getDb,
  grantDocketPro,
  seedBaseOrg,
  seedStatuses,
  seedUserWithHub,
} from '../support/routes-harness';

const backend = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock('../../src/routes/lattice-backend', () => ({ resolveOwnerBackend: backend.resolve }));
let schema: typeof DbModule;
let route: typeof assessmentRouter;
beforeAll(async () => {
  schema = await getDb();
  route = (await import('../../src/routes/daily-plan-assessment')).default;
});
const date = '2026-10-06';
const draft = {
  date,
  finishAt: '2026-10-07T00:00:00.000Z',
  mainTaskId: null,
  tasks: [],
  sessions: [],
};
const request = (value: DailyPlanSnapshot = draft) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ draft: value, proposalFingerprint: 'current-revision' }),
});

describe('optional daily plan assessment authorization', () => {
  it('requires the caller session', async () => {
    expect(
      (await appWithSession(route, null).request(`/day/${date}/assessment`, request())).status,
    ).toBe(401);
  });
  it('rejects private task pointers before calling a model', async () => {
    const owner = await seedUserWithHub(schema.db, schema, 'AssessmentPrivate');
    const response = await appWithSession(route, fakeSession(owner)).request(
      `/day/${date}/assessment`,
      request({
        ...draft,
        tasks: [
          { taskId: 'private-task', organizationId: 'private-org', plannedMinutes: 30, sort: 0 },
        ],
      }),
    );
    expect(response.status).toBe(404);
    expect(backend.resolve).not.toHaveBeenCalled();
  });
  it('rejects a mismatched date before model execution', async () => {
    const owner = await seedUserWithHub(schema.db, schema, 'AssessmentDate');
    expect(
      (
        await appWithSession(route, fakeSession(owner)).request(
          `/day/${date}/assessment`,
          request({ ...draft, date: '2026-10-07' }),
        )
      ).status,
    ).toBe(422);
  });
  it('sends only visible projects and task titles to the selected runtime', async () => {
    const owner = await seedUserWithHub(schema.db, schema, 'AssessmentGrounding');
    const { orgId, teamId } = await seedBaseOrg(schema.db, schema);
    const statusId = await seedStatuses(schema.db, schema, orgId);
    await grantDocketPro(schema.db, schema, orgId);
    await schema.db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'Planner', userId: owner });
    const [visible, privateProject] = await schema.db
      .insert(schema.project)
      .values([
        {
          organizationId: orgId,
          teamId,
          name: 'Visible launch',
          status: 'planned',
          statusId: statusId('project', 'planned'),
        },
        {
          organizationId: orgId,
          teamId,
          name: 'Secret launch',
          visibility: 'private',
          status: 'planned',
          statusId: statusId('project', 'planned'),
        },
      ])
      .returning();
    if (!visible || !privateProject) throw new Error('Missing project fixture');
    await schema.db.insert(schema.task).values([
      {
        organizationId: orgId,
        teamId,
        projectId: visible.id,
        title: 'Public task',
        state: 'backlog',
        statusId: statusId('task', 'backlog'),
      },
      {
        organizationId: orgId,
        teamId,
        projectId: visible.id,
        visibility: 'private',
        title: 'Secret task',
        state: 'backlog',
        statusId: statusId('task', 'backlog'),
      },
    ]);
    let referenceData = '';
    backend.resolve.mockResolvedValueOnce({
      kind: 'lattice',
      deviceId: 'selected-device',
      runtime: {
        async *streamTurn(input: {
          messages: readonly { content: readonly { text: string }[] }[];
        }) {
          referenceData = JSON.stringify(input.messages);
          yield {
            type: 'tool_use',
            id: 'reply',
            name: 'return_daily_plan_assessment',
            input: { assessment: 'The day leaves space for launch work.', suggestions: [] },
          };
        },
      },
    });
    const response = await appWithSession(route, fakeSession(owner)).request(
      `/day/${date}/assessment`,
      request(),
    );
    expect(response.status).toBe(200);
    expect(referenceData).toContain('Visible launch');
    expect(referenceData).toContain('Public task');
    expect(referenceData).not.toContain('Secret launch');
    expect(referenceData).not.toContain('Secret task');
    expect(backend.resolve).toHaveBeenLastCalledWith(owner);
  });

  it('returns an empty assessment when the chosen backend cannot run', async () => {
    backend.resolve.mockRejectedValueOnce(new Error('private device details'));
    const owner = await seedUserWithHub(schema.db, schema, 'AssessmentUnavailable');
    const response = await appWithSession(route, fakeSession(owner)).request(
      `/day/${date}/assessment`,
      request(),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      proposalFingerprint: 'current-revision',
      assessment: null,
      suggestions: [],
    });
  });
});
