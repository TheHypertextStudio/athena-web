import type * as DbModule from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import directiveFeed from '../../../src/routes/schedule-week-directive';
import scheduleWeek from '../../../src/routes/schedule-week';
import { appWithSession, fakeSession, getDb, seedUserWithHub } from '../../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

const TZ = 'America/Los_Angeles';
/** A Monday, and the Tuesday inside that week. */
const WEEK = '2026-10-05';
const DAY = '2026-10-06';

interface Fixture {
  readonly directive: ReturnType<typeof appWithSession>;
  readonly planner: ReturnType<typeof appWithSession>;
  readonly userId: string;
  readonly hubId: string;
}

/** Seed a person with a planned week, so the day loop has a real day to run against. */
async function seedDay(label: string, options: { plan?: boolean } = {}): Promise<Fixture> {
  const userId = await seedUserWithHub(db, schema, label);
  const [hubRow] = await db
    .select({ id: schema.hub.id })
    .from(schema.hub)
    .where(eq(schema.hub.userId, userId))
    .limit(1);
  if (!hubRow) throw new Error('seeded user has no hub');

  const session = fakeSession(userId, label, `${label}@example.com`);
  const planner = appWithSession(scheduleWeek, session);
  const directive = appWithSession(directiveFeed, session);

  await planner.request('/preferences', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      timezone: TZ,
      commitments: [
        {
          shape: 'deep_writing',
          title: 'Write and plan longer-term work',
          organizationId: null,
          taskId: null,
          sessionsPerWeek: 3,
          minutesPerSession: 120,
          location: null,
          attendees: [],
          active: true,
        },
      ],
      reflectionForMeetings: false,
      backfillShapes: ['deep_writing', 'architecture_brainstorm'],
    }),
  });

  if (options.plan !== false) {
    const res = await planner.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ weekStartDate: WEEK }),
    });
    expect(res.status).toBe(200);
  }

  return { directive, planner, userId, hubId: hubRow.id };
}

describe('GET /directive/day-start — the wake handshake', () => {
  it('reports a not-ready state instead of an empty agenda when nothing has been planned', async () => {
    const { directive } = await seedDay('DirectiveUnplanned', { plan: false });
    const res = await directive.request(`/day-start?date=${DAY}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ready: boolean;
      readiness: string;
      agenda: unknown[];
      gate: { state: string; outstandingSteps: string[] };
    };
    expect(body.ready).toBe(false);
    expect(body.readiness).toBe('not_generated');
    expect(body.agenda).toEqual([]);
    expect(body.gate.state).toBe('holding');
    expect(body.gate.outstandingSteps).toEqual(['agenda_reviewed']);
  });

  it('reports a ready agenda once the week has been generated', async () => {
    const { directive } = await seedDay('DirectiveReady');
    const res = await directive.request(`/day-start?date=${DAY}`);
    const body = (await res.json()) as {
      ready: boolean;
      readiness: string;
      agenda: { title: string; status: string }[];
      acknowledgedAt: string | null;
    };
    expect(body.readiness).toBe('ready');
    expect(body.ready).toBe(true);
    expect(body.agenda.length).toBeGreaterThan(0);
    expect(body.acknowledgedAt).toBeNull();
  });
});

describe('POST /directive/day-start/acknowledge — the morning release signal', () => {
  it('is absent until the flow is completed, fires exactly once, and is then permanent', async () => {
    const { directive, hubId } = await seedDay('DirectiveAck');

    const before = await directive.request(`/day-start?date=${DAY}`);
    expect(((await before.json()) as { acknowledgedAt: string | null }).acknowledgedAt).toBeNull();

    const first = await directive.request(`/day-start/acknowledge?date=${DAY}`, { method: 'POST' });
    const firstBody = (await first.json()) as { fired: boolean; acknowledgedAt: string | null };
    expect(firstBody.fired).toBe(true);
    expect(firstBody.acknowledgedAt).not.toBeNull();

    const second = await directive.request(`/day-start/acknowledge?date=${DAY}`, {
      method: 'POST',
    });
    const secondBody = (await second.json()) as { fired: boolean; acknowledgedAt: string | null };
    expect(secondBody.fired, 'a second call must not manufacture a second signal').toBe(false);
    expect(secondBody.acknowledgedAt).toBe(firstBody.acknowledgedAt);

    const rows = await db
      .select({ at: schema.dayDirective.agendaAcknowledgedAt })
      .from(schema.dayDirective)
      .where(and(eq(schema.dayDirective.hubId, hubId), eq(schema.dayDirective.date, DAY)));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.at).not.toBeNull();
  });

  it('refuses to release a day whose agenda was never generated', async () => {
    const { directive } = await seedDay('DirectiveAckUnready', { plan: false });
    const res = await directive.request(`/day-start/acknowledge?date=${DAY}`, { method: 'POST' });
    const body = (await res.json()) as { fired: boolean; readiness: string };
    expect(body.fired).toBe(false);
    expect(body.readiness).toBe('not_generated');
  });

  it('keeps a stub consuming client holding until the signal arrives', async () => {
    const { directive } = await seedDay('DirectiveStubClient');

    /** A minimal stand-in for a device-posture client: it holds while its gate holds. */
    const stubClient = {
      holding: true,
      async poll(): Promise<void> {
        const res = await directive.request(`/day-start?date=${DAY}`);
        const body = (await res.json()) as { gate: { state: string } };
        this.holding = body.gate.state === 'holding';
      },
    };

    await stubClient.poll();
    expect(stubClient.holding).toBe(true);
    await stubClient.poll();
    expect(stubClient.holding, 'polling alone must never release the gate').toBe(true);

    await directive.request(`/day-start/acknowledge?date=${DAY}`, { method: 'POST' });
    await stubClient.poll();
    expect(stubClient.holding).toBe(false);
  });
});

describe('GET /directive/check-ins — repeated check-ins against the day’s goals', () => {
  it('issues at least three check-ins for the day, each naming its block and outstanding goals', async () => {
    const { directive } = await seedDay('DirectiveCheckIns');
    const res = await directive.request(`/check-ins?date=${DAY}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: {
        id: string;
        scheduledAt: string;
        prompt: string;
        outstandingGoals: number;
        respondedAt: string | null;
        response: string | null;
      }[];
    };
    expect(body.items.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < body.items.length; i += 1) {
      expect(Date.parse(body.items[i]?.scheduledAt ?? '')).toBeGreaterThan(
        Date.parse(body.items[i - 1]?.scheduledAt ?? ''),
      );
    }
    for (const item of body.items) {
      expect(item.prompt.length).toBeGreaterThan(0);
      expect(item.outstandingGoals).toBeGreaterThanOrEqual(0);
      expect(item.respondedAt).toBeNull();
      expect(item.response).toBeNull();
    }
  });

  it('is idempotent: reading twice does not multiply the day’s check-ins', async () => {
    const { directive, hubId } = await seedDay('DirectiveCheckInsIdempotent');
    await directive.request(`/check-ins?date=${DAY}`);
    const first = (await (await directive.request(`/check-ins?date=${DAY}`)).json()) as {
      items: unknown[];
    };
    await directive.request(`/check-ins?date=${DAY}`);
    const second = (await (await directive.request(`/check-ins?date=${DAY}`)).json()) as {
      items: unknown[];
    };
    expect(second.items.length).toBe(first.items.length);

    const rows = await db
      .select({ id: schema.dayCheckIn.id })
      .from(schema.dayCheckIn)
      .where(and(eq(schema.dayCheckIn.hubId, hubId), eq(schema.dayCheckIn.date, DAY)));
    expect(rows.length).toBe(first.items.length);
  });

  it('records the person’s own answer, and records a non-response as a fact', async () => {
    const { directive } = await seedDay('DirectiveRespond');
    const listed = (await (await directive.request(`/check-ins?date=${DAY}`)).json()) as {
      items: { id: string }[];
    };
    const target = listed.items[0];
    expect(target).toBeDefined();

    const res = await directive.request(`/check-ins/${target?.id ?? ''}/respond`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ response: 'behind', note: 'Ran long on the memo' }),
    });
    expect(res.status).toBe(200);
    const after = (await res.json()) as {
      items: { id: string; response: string | null; respondedAt: string | null }[];
    };
    const answered = after.items.find((i) => i.id === target?.id);
    expect(answered?.response).toBe('behind');
    expect(answered?.respondedAt).not.toBeNull();

    // Every other check-in is still recorded, unanswered — an absence of data would be worse.
    const unanswered = after.items.filter((i) => i.id !== target?.id);
    expect(unanswered.length).toBeGreaterThan(0);
    expect(unanswered.every((i) => i.response === null)).toBe(true);
  });

  it('refuses to answer a check-in belonging to someone else', async () => {
    const mine = await seedDay('DirectiveScopeMine');
    const theirs = await seedDay('DirectiveScopeTheirs');
    const theirCheckIns = (await (
      await theirs.directive.request(`/check-ins?date=${DAY}`)
    ).json()) as { items: { id: string }[] };
    const theirId = theirCheckIns.items[0]?.id ?? '';

    const res = await mine.directive.request(`/check-ins/${theirId}/respond`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ response: 'on_track' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /directive — posture and gates', () => {
  it('publishes a posture, a plain reason, and both gates', async () => {
    const { directive } = await seedDay('DirectivePosture');
    const res = await directive.request(`/?date=${DAY}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      schemaVersion: string;
      directiveId: string;
      posture: string;
      reason: string;
      gates: { kind: string; state: string }[];
      plan: unknown[];
      agendaReadiness: string;
    };
    expect(body.schemaVersion).toBe('directive/1');
    expect(body.directiveId.length).toBeGreaterThan(0);
    expect(['on_track', 'attention_needed', 'intervention_recommended']).toContain(body.posture);
    expect(body.reason.length).toBeGreaterThan(0);
    expect(body.reason.length).toBeLessThanOrEqual(280);
    expect(body.gates.map((g) => g.kind).sort()).toEqual(['day_end', 'day_start']);
    expect(body.agendaReadiness).toBe('ready');
    expect(body.plan.length).toBeGreaterThan(0);
  });

  it('names no enforcement anywhere in the payload', async () => {
    const { directive } = await seedDay('DirectiveVocabulary');
    const res = await directive.request(`/?date=${DAY}`);
    const raw = (await res.text()).toLowerCase();
    for (const forbidden of ['curfew', 'lockout', 'lock_device', 'quit app', 'kill ', 'overlay']) {
      expect(raw, `directive payload leaked "${forbidden}"`).not.toContain(forbidden);
    }
  });

  it('accepts an acknowledgement idempotently on the same directive id', async () => {
    const { directive, hubId } = await seedDay('DirectiveAcknowledge');
    const first = (await (await directive.request(`/?date=${DAY}`)).json()) as {
      directiveId: string;
      posture: string;
    };

    const body = JSON.stringify({
      directiveId: first.directiveId,
      appliedPosture: first.posture,
      enforced: true,
      note: 'held the session until the agenda was read',
    });
    const one = await directive.request('/acknowledge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    const two = await directive.request('/acknowledge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    expect(one.status).toBe(200);
    expect(two.status).toBe(200);

    const rows = await db
      .select()
      .from(schema.directiveAcknowledgment)
      .where(eq(schema.directiveAcknowledgment.hubId, hubId));
    expect(rows, 'a retry must overwrite, not append').toHaveLength(1);
    expect(rows[0]?.enforced).toBe(true);
  });
});

describe('the end-of-day review gates the close of the day', () => {
  it('walks reconcile → reflect → confirm, releasing only at the end', async () => {
    const { directive } = await seedDay('DirectiveReview');

    const opened = (await (await directive.request(`/review?date=${DAY}`)).json()) as {
      steps: { key: string; complete: boolean; outstanding: number }[];
      items: { key: string; title: string; disposition: string | null }[];
      answers: { key: string; answer: string | null }[];
      gate: { state: string; outstandingSteps: string[] };
      complete: boolean;
    };
    expect(opened.items.length).toBeGreaterThan(0);
    expect(opened.items.every((i) => i.disposition === null)).toBe(true);
    expect(opened.gate.state).toBe('holding');
    expect(opened.gate.outstandingSteps).toEqual([
      'day_reconciled',
      'day_reflected',
      'tomorrow_confirmed',
    ]);

    // Confirming tomorrow before the earlier steps are done is refused.
    const early = await directive.request(`/review/confirm-tomorrow?date=${DAY}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ acceptedKeys: [] }),
    });
    expect(early.status).toBe(422);

    // Step one: every unfinished item gets a decision.
    let current = opened;
    for (const item of opened.items) {
      const res = await directive.request(`/review/disposition?date=${DAY}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          key: item.key,
          disposition: 'rescheduled',
          rescheduledTo: '2026-10-07',
        }),
      });
      expect(res.status).toBe(200);
      current = (await res.json()) as typeof opened;
    }
    expect(current.steps.find((s) => s.key === 'reconcile')?.complete).toBe(true);
    expect(current.gate.outstandingSteps).toEqual(['day_reflected', 'tomorrow_confirmed']);

    // Step two: the three fixed questions.
    for (const key of ['what_moved', 'what_blocked', 'what_changes_tomorrow']) {
      const res = await directive.request(`/review/answer?date=${DAY}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key, answer: `Answer for ${key}` }),
      });
      expect(res.status).toBe(200);
      current = (await res.json()) as typeof opened;
    }
    expect(current.gate.outstandingSteps).toEqual(['tomorrow_confirmed']);
    expect(current.complete).toBe(false);

    // Step three: tomorrow is confirmed explicitly, and only then does the gate open.
    const withProposals = (await (await directive.request(`/review?date=${DAY}`)).json()) as {
      tomorrowProposals: { key: string }[];
      tomorrowDate: string;
    };
    expect(withProposals.tomorrowDate).toBe('2026-10-07');
    expect(withProposals.tomorrowProposals.length).toBeGreaterThan(0);

    const confirmed = await directive.request(`/review/confirm-tomorrow?date=${DAY}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ acceptedKeys: withProposals.tomorrowProposals.map((p) => p.key) }),
    });
    expect(confirmed.status).toBe(200);
    const done = (await confirmed.json()) as {
      complete: boolean;
      tomorrowConfirmedAt: string | null;
      gate: { state: string; outstandingSteps: string[] };
    };
    expect(done.complete).toBe(true);
    expect(done.tomorrowConfirmedAt).not.toBeNull();
    expect(done.gate.state).toBe('open');
    expect(done.gate.outstandingSteps).toEqual([]);
  });

  it('keeps a stub consuming client holding while any of the three steps is incomplete', async () => {
    const { directive } = await seedDay('DirectiveEndGateStub');

    /**
     * A minimal stand-in for a device-posture client: it reads the directive feed and holds
     * while the day-end gate holds. It knows nothing about what "holding" costs — that is the
     * point of the boundary.
     */
    const stubClient = {
      holding: false,
      outstanding: [] as string[],
      async poll(): Promise<void> {
        const res = await directive.request(`/?date=${DAY}`);
        const body = (await res.json()) as {
          gates: { kind: string; state: string; outstandingSteps: string[] }[];
        };
        const gate = body.gates.find((g) => g.kind === 'day_end');
        this.holding = gate?.state === 'holding';
        this.outstanding = gate?.outstandingSteps ?? [];
      },
    };

    const opened = (await (await directive.request(`/review?date=${DAY}`)).json()) as {
      items: { key: string }[];
    };
    expect(opened.items.length).toBeGreaterThan(0);

    await stubClient.poll();
    expect(stubClient.holding, 'nothing done yet').toBe(true);
    expect(stubClient.outstanding).toEqual([
      'day_reconciled',
      'day_reflected',
      'tomorrow_confirmed',
    ]);

    for (const item of opened.items) {
      await directive.request(`/review/disposition?date=${DAY}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          key: item.key,
          disposition: 'rescheduled',
          rescheduledTo: '2026-10-07',
        }),
      });
    }
    await stubClient.poll();
    expect(stubClient.holding, 'reconciled, but not reflected or confirmed').toBe(true);
    expect(stubClient.outstanding).toEqual(['day_reflected', 'tomorrow_confirmed']);

    for (const key of ['what_moved', 'what_blocked', 'what_changes_tomorrow']) {
      await directive.request(`/review/answer?date=${DAY}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key, answer: `Answer for ${key}` }),
      });
    }
    await stubClient.poll();
    expect(stubClient.holding, 'reflected, but tomorrow not confirmed').toBe(true);
    expect(stubClient.outstanding).toEqual(['tomorrow_confirmed']);

    const withProposals = (await (await directive.request(`/review?date=${DAY}`)).json()) as {
      tomorrowProposals: { key: string }[];
    };
    await directive.request(`/review/confirm-tomorrow?date=${DAY}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ acceptedKeys: withProposals.tomorrowProposals.map((p) => p.key) }),
    });
    await stubClient.poll();
    expect(stubClient.holding, 'all three steps done — the gate releases').toBe(false);
    expect(stubClient.outstanding).toEqual([]);
  });

  it('refuses to drop an item without a reason', async () => {
    const { directive } = await seedDay('DirectiveDropReason');
    const opened = (await (await directive.request(`/review?date=${DAY}`)).json()) as {
      items: { key: string }[];
    };
    const res = await directive.request(`/review/disposition?date=${DAY}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: opened.items[0]?.key, disposition: 'dropped' }),
    });
    expect(res.status).toBe(422);
  });

  it('refuses to reschedule an item without a date', async () => {
    const { directive } = await seedDay('DirectiveRescheduleDate');
    const opened = (await (await directive.request(`/review?date=${DAY}`)).json()) as {
      items: { key: string }[];
    };
    const res = await directive.request(`/review/disposition?date=${DAY}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: opened.items[0]?.key, disposition: 'rescheduled' }),
    });
    expect(res.status).toBe(422);
  });

  it('accepts a drop that carries a reason, and holds the gate until the rest is done', async () => {
    const { directive } = await seedDay('DirectiveDropOk');
    const opened = (await (await directive.request(`/review?date=${DAY}`)).json()) as {
      items: { key: string }[];
    };
    const res = await directive.request(`/review/disposition?date=${DAY}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        key: opened.items[0]?.key,
        disposition: 'dropped',
        reason: 'The council meeting was cancelled',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: { disposition: string | null; reason: string | null }[];
      gate: { state: string };
    };
    expect(body.items[0]?.disposition).toBe('dropped');
    expect(body.items[0]?.reason).toBe('The council meeting was cancelled');
    expect(body.gate.state).toBe('holding');
  });
});

describe('POST /directive/reorganize', () => {
  it('is safe on a day that has not drifted', async () => {
    const { directive } = await seedDay('DirectiveReorgNoop');
    const res = await directive.request(`/reorganize?date=${DAY}`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      movedBlocks: unknown[];
      displacedBlocks: unknown[];
      driftMinutes: number;
    };
    expect(body.driftMinutes).toBe(0);
    expect(body.displacedBlocks).toEqual([]);
  });
});
