/**
 * `@docket/api` — the boundary loop as the five-minute posture sweep actually runs it.
 *
 * @remarks
 * `extension-service.test.ts` drives the service directly, which is the right shape for the
 * policy edges. This file drives the **real** `sweepDirectivePosture` over **real** calendar rows
 * instead, because the load-bearing claim of this step is not "the service works" — it is "this
 * behaviour rides the sweep that already exists, and repeating that sweep does not repeat the
 * consent prompt." A service-level idempotency test cannot prove the second half; only running
 * the actual sweep twice can.
 */
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { assertDefined } from '@docket/test-utils';

import type * as DbModule from '@docket/db';

import type { sweepDirectivePosture as SweepDirectivePosture } from '../../../src/routes/directive-sweep';
import { readExtensionRequests } from '../../../src/services/boundary/extension-service';
import type {
  BoundaryExtensionRequest,
  BoundaryRequestOutcome,
  BoundaryRequestState,
  BoundarySubmission,
  DayBoundaryPort,
} from '../../../src/services/boundary/port';
import { setDayBoundaryPort } from '../../../src/services/boundary/registry';
import { instantAt } from '@docket/planning/zoned-time';
import { getMigratedDb } from '../../support/db';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let sweepDirectivePosture!: typeof SweepDirectivePosture;

beforeAll(async () => {
  vi.stubEnv('MCP_ISSUER_URL', 'https://auth.docket.test');
  vi.stubEnv('MCP_RESOURCE_URL', 'https://api.docket.test/mcp');
  schema = await getMigratedDb();
  db = schema.db;
  sweepDirectivePosture = (await import('../../../src/routes/directive-sweep'))
    .sweepDirectivePosture;
});

afterEach(() => {
  setDayBoundaryPort(null);
});

const TZ = 'UTC';
const DATE = '2026-08-12';
const DAY_START_MINUTE = 9 * 60;
const DAY_END_MINUTE = 17 * 60;

function at(minuteOfDay: number): Date {
  return instantAt(DATE, minuteOfDay, TZ);
}

/** 16:00 — an hour before the working window closes. */
const EVENING = at(16 * 60);

/** The same two-method port a real MCP client implements. */
class FakeBoundaryPort implements DayBoundaryPort {
  readonly submissions: BoundaryExtensionRequest[] = [];
  outcome: BoundaryRequestOutcome = { state: 'pending', detail: null };
  #next = 0;

  async submitExtensionRequest(request: BoundaryExtensionRequest): Promise<BoundarySubmission> {
    this.submissions.push(request);
    this.#next += 1;
    return await Promise.resolve({ requestId: `sweep-req-${String(this.#next)}` });
  }

  async pollExtensionRequest(): Promise<BoundaryRequestOutcome> {
    return await Promise.resolve(this.outcome);
  }

  answer(state: BoundaryRequestState, detail: string | null = null): void {
    this.outcome = { state, detail };
  }
}

interface Seed {
  userId: string;
  hubId: string;
  /**
   * The overflowing block's title, unique per seed.
   *
   * @remarks
   * The sweep is global by design — it evaluates every configured Hub, including ones other
   * tests in this worker seeded. So nothing here asserts on a sweep-wide counter or on a bare
   * submission count; assertions are scoped to this Hub's rows and to the submissions carrying
   * this Hub's own block title.
   */
  deckTitle: string;
  morningTitle: string;
}

/**
 * Seed a Hub the sweep will pick up, with a day that genuinely overflows its window.
 *
 * @remarks
 * The 09:00 block runs to 15:30 and is unfinished, so at 16:00 it is what is actually being
 * worked and it consumes the day up to now. The block behind it needs ninety minutes and the
 * window has sixty left. The day is short, not merely late.
 */
async function seedOverflowingHub(): Promise<Seed> {
  const slug = `bs-${Math.random().toString(36).slice(2, 10)}`;
  const [u] = await db
    .insert(schema.user)
    .values({ name: 'Ada', email: `${slug}@e.test` })
    .returning({ id: schema.user.id });
  const [h] = await db
    .insert(schema.hub)
    .values({ userId: assertDefined(u).id })
    .returning({ id: schema.hub.id });
  await db.insert(schema.schedulingPreference).values({
    hubId: assertDefined(h).id,
    timezone: TZ,
    windows: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      startMinute: DAY_START_MINUTE,
      endMinute: DAY_END_MINUTE,
      kind: 'desk',
      label: null,
    })),
  });
  const [layer] = await db
    .insert(schema.calendarLayer)
    .values({
      userId: assertDefined(u).id,
      connectionId: null,
      provider: 'docket',
      sourceKind: 'native_blocks',
      title: 'Docket blocks',
      selected: true,
      visibleByDefault: true,
      editableCore: true,
      primary: false,
    })
    .returning({ id: schema.calendarLayer.id });

  const deckTitle = `Finish Q3 deck ${slug}`;
  const morningTitle = `Morning deep work ${slug}`;
  for (const spec of [
    { title: morningTitle, start: at(DAY_START_MINUTE), end: at(15 * 60 + 30) },
    { title: deckTitle, start: at(15 * 60 + 30), end: at(17 * 60) },
  ]) {
    await db.insert(schema.calendarItem).values({
      userId: assertDefined(u).id,
      layerId: assertDefined(layer).id,
      connectionId: null,
      kind: 'native_block',
      provider: 'docket',
      status: 'confirmed',
      syncState: 'clean',
      title: spec.title,
      startsAt: spec.start,
      endsAt: spec.end,
      workShape: 'deep_writing',
      origin: 'scheduler',
    });
  }
  return { userId: assertDefined(u).id, hubId: assertDefined(h).id, deckTitle, morningTitle };
}

/** How many consent prompts this Hub's own deadline has raised. */
function promptsFor(port: FakeBoundaryPort, seed: Seed): number {
  return port.submissions.filter((s) => s.reason.includes(seed.deckTitle)).length;
}

describe('sweepDirectivePosture — the boundary loop', () => {
  // ── Acceptance criterion E ──────────────────────────────────────────────────────────────────
  it('raises one request per deadline across repeated sweeps, not one per sweep', async () => {
    const seed = await seedOverflowingHub();
    const port = new FakeBoundaryPort();
    setDayBoundaryPort(port);

    const first = await sweepDirectivePosture(EVENING);
    expect(first.failed).toBe(0);
    expect(promptsFor(port, seed)).toBe(1);

    // The second sweep sees the identical still-overflowing day. It must not ask again.
    const second = await sweepDirectivePosture(EVENING);
    expect(second.failed).toBe(0);

    // The proof is the persisted state: one row, still pending, for the one deadline.
    const rows = await readExtensionRequests(db, seed.hubId, DATE);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe('pending');
    expect(rows[0]?.reason).toContain(seed.deckTitle);
    expect(rows[0]?.requestedMinutes).toBeLessThanOrEqual(120);

    // And exactly one consent prompt was ever raised for this deadline.
    expect(promptsFor(port, seed)).toBe(1);

    // Six more sweeps change nothing.
    for (let i = 0; i < 6; i += 1) await sweepDirectivePosture(EVENING);
    expect(await readExtensionRequests(db, seed.hubId, DATE)).toHaveLength(1);
    expect(promptsFor(port, seed)).toBe(1);
  });

  it('resolves a pending request on a later sweep even when the posture has not moved', async () => {
    const seed = await seedOverflowingHub();
    const port = new FakeBoundaryPort();
    setDayBoundaryPort(port);

    await sweepDirectivePosture(EVENING);
    port.answer('denied', 'Not right now');

    // The posture is identical, so this sweep publishes nothing — the request must still settle.
    const settling = await sweepDirectivePosture(EVENING);
    expect(settling.changed).toBe(0);
    expect(settling.extensionsResolved).toBeGreaterThanOrEqual(1);

    const rows = await readExtensionRequests(db, seed.hubId, DATE);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe('denied');

    // The day plan survived the refusal intact: both blocks are exactly where they were.
    const items = await db
      .select({ title: schema.calendarItem.title, startsAt: schema.calendarItem.startsAt })
      .from(schema.calendarItem)
      .where(eq(schema.calendarItem.userId, seed.userId))
      .orderBy(schema.calendarItem.startsAt);
    expect(items.map((i) => i.title)).toEqual([seed.morningTitle, seed.deckTitle]);
    expect(items[0]?.startsAt?.toISOString()).toBe(at(DAY_START_MINUTE).toISOString());
    expect(items[1]?.startsAt?.toISOString()).toBe(at(15 * 60 + 30).toISOString());
  });

  it('asks for nothing when the deployment has no boundary client installed', async () => {
    const seed = await seedOverflowingHub();
    // No port installed — the default state of every deployment today.
    const result = await sweepDirectivePosture(EVENING);
    expect(result.failed).toBe(0);
    expect(result.extensionsRequested).toBe(0);
    expect(await readExtensionRequests(db, seed.hubId, DATE)).toHaveLength(0);
  });
});
