import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { assertDefined } from '@docket/test-utils';
import { appWithSession, fakeSession, getDb } from '../support/routes-harness';

import type { AdminAthenaUsageOut } from '../../src/admin-dto';
import { addRunUsage } from '../../src/agent/run-generation';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let admin!: unknown;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  admin = (await import('../../src/app')).adminRouter;
});

let counter = 0;
/** A unique suffix per call — the PGlite database is shared across this suite. */
function uniq(): string {
  counter += 1;
  return `${Date.now().toString(36)}${counter}`;
}

/** Insert a staff user and return the signing-in user's id. */
async function makeStaff(): Promise<string> {
  const u = uniq();
  const users = await db
    .insert(schema.user)
    .values({ name: `Operator ${u}`, email: `operator-${u}@example.com` })
    .returning({ id: schema.user.id });
  const userId = assertDefined(users[0]).id;
  await db.insert(schema.staffUser).values({ userId, role: 'support' });
  return userId;
}

/** Insert a session and one generation on it; returns the run's id. */
async function makeRun(options: {
  readonly surface: 'docket' | 'lattice';
  readonly kind: 'chat' | 'job';
}): Promise<string> {
  const u = uniq();
  // An `athena` session is owned by a person, not an organization — the schema's executor-shape
  // check enforces exactly that pairing.
  const owners = await db
    .insert(schema.user)
    .values({ name: `Owner ${u}`, email: `owner-${u}@example.com` })
    .returning({ id: schema.user.id });
  const ownerUserId = assertDefined(owners[0]).id;
  const sessions = await db
    .insert(schema.agentSession)
    .values({
      executorKind: 'athena',
      ownerUserId,
      trigger: 'assignment',
      status: 'running',
      kind: options.kind,
      executionSurface: options.surface,
    })
    .returning({ id: schema.agentSession.id });
  const sessionId = assertDefined(sessions[0]).id;

  const runs = await db
    .insert(schema.agentSessionRun)
    // The run mirrors its session's attribution; the schema checks that they agree.
    .values({ sessionId, ownerUserId, generation: 1, workflowInstanceId: `${sessionId}:1` })
    .returning({ id: schema.agentSessionRun.id });
  return assertDefined(runs[0]).id;
}

/** Read the usage report as an admitted operator. */
async function readUsage(userId: string): Promise<AdminAthenaUsageOut> {
  const app = appWithSession(admin, fakeSession(userId));
  const res = await app.request('/athena-usage', { method: 'GET' });
  expect(res.status).toBe(200);
  return (await res.json()) as AdminAthenaUsageOut;
}

/** The slice for one grouping value. */
function sliceOf(
  slices: AdminAthenaUsageOut['byModel'],
  key: string,
): AdminAthenaUsageOut['byModel'][number] | undefined {
  return slices.find((slice) => slice.key === key);
}

describe('Athena usage', () => {
  it('refuses an anonymous caller', async () => {
    const anonymous = appWithSession(admin, null);
    expect((await anonymous.request('/athena-usage', { method: 'GET' })).status).toBe(401);
  });

  it('accumulates a generation total across its turns rather than keeping only the last', async () => {
    const runId = await makeRun({ surface: 'docket', kind: 'job' });

    await addRunUsage(db, runId, {
      inputTokens: 100,
      outputTokens: 10,
      cacheReadTokens: 1000,
      cacheCreationTokens: 5,
      model: 'claude-opus-4-8',
    });
    await addRunUsage(db, runId, {
      inputTokens: 50,
      outputTokens: 7,
      cacheReadTokens: 2000,
      cacheCreationTokens: 0,
      model: 'claude-opus-4-8',
    });

    const rows = await db
      .select()
      .from(schema.agentSessionRun)
      .where(eq(schema.agentSessionRun.id, runId));
    const run = assertDefined(rows[0]);
    // A multi-turn generation costs the sum of its turns; overwriting would report only the last.
    expect(run.inputTokens).toBe(150);
    expect(run.outputTokens).toBe(17);
    expect(run.cacheReadTokens).toBe(3000);
    expect(run.cacheCreationTokens).toBe(5);
    expect(run.model).toBe('claude-opus-4-8');
  });

  it('leaves an unreported generation null, so unmeasured never reads as free', async () => {
    const runId = await makeRun({ surface: 'lattice', kind: 'job' });

    await addRunUsage(db, runId, undefined);

    const rows = await db
      .select()
      .from(schema.agentSessionRun)
      .where(eq(schema.agentSessionRun.id, runId));
    const run = assertDefined(rows[0]);
    // Lattice runs on someone else's compute and reports nothing. Zero would claim it was free.
    expect(run.inputTokens).toBeNull();
    expect(run.model).toBeNull();
  });

  it('reports measured runs beside the token totals', async () => {
    const userId = await makeStaff();
    const measured = await makeRun({ surface: 'docket', kind: 'chat' });
    await makeRun({ surface: 'lattice', kind: 'chat' });

    await addRunUsage(db, measured, {
      inputTokens: 42,
      outputTokens: 3,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      model: 'claude-opus-4-8',
    });

    const usage = await readUsage(userId);
    // The pairing is the point: a small token total means something different when most runs were
    // never measured.
    expect(usage.runs).toBeGreaterThanOrEqual(2);
    expect(usage.measuredRuns).toBeLessThan(usage.runs);
    expect(usage.tokens.inputTokens).toBeGreaterThanOrEqual(42);
  });

  it('groups by model, surface, and kind without losing runs from the headline', async () => {
    const userId = await makeStaff();
    await makeRun({ surface: 'lattice', kind: 'chat' });

    const usage = await readUsage(userId);

    for (const slices of [usage.byModel, usage.bySurface, usage.byKind]) {
      const grouped = slices.reduce((total, slice) => total + slice.runs, 0);
      // Every generation lands in exactly one bucket per dimension, `unknown` included, so a
      // slice list that disagreed with the headline would be hiding runs.
      expect(grouped).toBe(usage.runs);
    }
    expect(sliceOf(usage.bySurface, 'lattice')?.runs).toBeGreaterThan(0);
  });

  it('reports an unmeasured model as unknown rather than dropping the run', async () => {
    const userId = await makeStaff();
    await makeRun({ surface: 'lattice', kind: 'job' });

    const usage = await readUsage(userId);
    expect(sliceOf(usage.byModel, 'unknown')?.runs).toBeGreaterThan(0);
  });
});
