import { describe, expect, it } from 'vitest';

import { MockMcpConnector } from '../../src/mcp-connector';
import {
  SUNSAMA_FIXTURE_HOST,
  SUNSAMA_FIXTURE_URL,
  SUNSAMA_MIGRATION_FIXTURE_SERVER,
} from '../../src/sunsama-fixtures';

/**
 * Direct tests of the offline Sunsama stand-in's own tool implementations.
 *
 * @remarks
 * `readSunsamaAccount` (exercised in `sunsama-reader.test.ts`) never calls the `getUser` or
 * `getTask` capabilities — nothing in the current migration reads them, even though the fixture
 * implements both (`get_user`, `get_task_by_id`) because {@link SUNSAMA_CAPABILITIES} declares them
 * and a real Sunsama server answers them. That leaves this fixture's own branching — the id lookup,
 * the not-found path, the unrecognised-tool path — untested by anything that consumes it today. A
 * bug here would not show up as a failing migration test; it would show up as a broken fixture the
 * moment some future feature (e.g. an incremental per-task refresh) starts calling `get_task_by_id`
 * against it. Testing the stand-in directly, the same way a mock's own behaviour gets tested, is
 * what makes that fixture trustworthy ahead of that future use rather than only in hindsight.
 */
async function fixtureSession() {
  const connector = new MockMcpConnector({
    servers: { [SUNSAMA_FIXTURE_HOST]: SUNSAMA_MIGRATION_FIXTURE_SERVER },
  });
  return connector.open({ url: SUNSAMA_FIXTURE_URL });
}

describe('SUNSAMA_MIGRATION_FIXTURE_SERVER — the offline Sunsama stand-in', () => {
  it('serves get_user for the capability the current migration does not yet call', async () => {
    const session = await fixtureSession();
    const result = await session.callTool('get_user', {});
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content)).toEqual({
      id: 'usr-fixture',
      email: 'willie@lasvegasfortransit.org',
      timezone: 'America/Los_Angeles',
    });
  });

  it('looks a task up by id across both the active and archived sets', async () => {
    const session = await fixtureSession();
    const active = await session.callTool('get_task_by_id', { taskId: 'su-001' });
    expect(active.isError).toBe(false);
    expect(JSON.parse(active.content)).toMatchObject({ _id: 'su-001' });

    const archived = await session.callTool('get_task_by_id', { taskId: 'su-900' });
    expect(archived.isError).toBe(false);
    expect(JSON.parse(archived.content)).toMatchObject({ _id: 'su-900' });
  });

  it('reports isError rather than fabricating a task when the id is unknown or absent', async () => {
    const session = await fixtureSession();

    const unknown = await session.callTool('get_task_by_id', { taskId: 'does-not-exist' });
    expect(unknown.isError).toBe(true);
    expect(unknown.content).toMatch(/Task not found: does-not-exist/);

    // No `taskId` at all on the input — the lookup id falls back to '' rather than throwing.
    const missingInput = await session.callTool('get_task_by_id', {});
    expect(missingInput.isError).toBe(true);
    expect(missingInput.content).toMatch(/Task not found: $/);
  });

  it('rejects a tool name it does not implement instead of silently returning nothing', async () => {
    const session = await fixtureSession();
    const result = await session.callTool('not_a_real_sunsama_tool', {});
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/Unknown tool: not_a_real_sunsama_tool/);
  });

  it('defaults get_tasks_by_day to an empty day rather than throwing when no day is given', async () => {
    const session = await fixtureSession();
    const result = await session.callTool('get_tasks_by_day', {});
    expect(result.isError).toBe(false);
    // No fixture task is planned for the empty-string day, so the filter comes back empty.
    expect(JSON.parse(result.content)).toEqual({ tasks: [] });
  });
});
