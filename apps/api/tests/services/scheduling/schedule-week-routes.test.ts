import type * as DbModule from '@docket/db';
import { and, eq, isNotNull } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import scheduleWeek from '../../../src/routes/schedule-week';
import { appWithSession, fakeSession, getDb, seedUserWithHub } from '../../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

const TZ = 'America/Los_Angeles';
/** A Monday well clear of any seeded fixture data. */
const WEEK = '2026-09-07';

/** The author's own six kinds of time, as standing weekly commitments. */
function sixCommitments(lvbtOrgId: string, engineeringOrgId: string) {
  return [
    {
      shape: 'filming_session' as const,
      title: 'LVBT filming session',
      organizationId: lvbtOrgId,
      taskId: null,
      sessionsPerWeek: 1,
      minutesPerSession: null,
      location: 'Bonneville Transit Center',
      attendees: [],
      active: true,
    },
    {
      shape: 'community_meeting' as const,
      title: 'LVBT community member meeting',
      organizationId: lvbtOrgId,
      taskId: null,
      sessionsPerWeek: 2,
      minutesPerSession: null,
      location: 'Downtown Las Vegas',
      attendees: ['rider@example.org', 'organizer@example.org'],
      active: true,
    },
    {
      shape: 'deep_writing' as const,
      title: 'Write and plan longer-term work',
      organizationId: null,
      taskId: null,
      sessionsPerWeek: 2,
      minutesPerSession: null,
      location: null,
      attendees: [],
      active: true,
    },
    {
      shape: 'interstitial_reading' as const,
      title: 'Reading',
      organizationId: null,
      taskId: null,
      sessionsPerWeek: 2,
      minutesPerSession: null,
      location: null,
      attendees: [],
      active: true,
    },
    {
      shape: 'architecture_brainstorm' as const,
      title: 'Brainstorm app and service architecture',
      organizationId: engineeringOrgId,
      taskId: null,
      sessionsPerWeek: 1,
      minutesPerSession: null,
      location: null,
      attendees: [],
      active: true,
    },
  ];
}

/** Seed a user, two workspaces, and their standing commitments. Returns the app + ids. */
async function seedPlanner(label: string): Promise<{
  app: ReturnType<typeof appWithSession>;
  userId: string;
  hubId: string;
  lvbtOrgId: string;
  engineeringOrgId: string;
}> {
  const userId = await seedUserWithHub(db, schema, label);
  const [hubRow] = await db
    .select({ id: schema.hub.id })
    .from(schema.hub)
    .where(eq(schema.hub.userId, userId))
    .limit(1);
  if (!hubRow) throw new Error('seeded user has no hub');

  const mkOrg = async (name: string): Promise<string> => {
    const slug = `${name}-${Math.random().toString(36).slice(2, 8)}`;
    const [org] = await db
      .insert(schema.organization)
      .values({ name, slug, lifecycleState: 'active' })
      .returning({ id: schema.organization.id });
    if (!org) throw new Error('org seed failed');
    await db
      .insert(schema.actor)
      .values({ organizationId: org.id, kind: 'human', userId, displayName: label })
      .returning({ id: schema.actor.id });
    return org.id;
  };
  const lvbtOrgId = await mkOrg('Las Vegans for Better Transit');
  const engineeringOrgId = await mkOrg('Hypertext Studio');

  const app = appWithSession(scheduleWeek, fakeSession(userId, label, `${label}@example.com`));
  const saved = await app.request('/preferences', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      timezone: TZ,
      commitments: sixCommitments(lvbtOrgId, engineeringOrgId),
      reflectionForMeetings: true,
      backfillShapes: ['deep_writing', 'architecture_brainstorm', 'interstitial_reading'],
    }),
  });
  expect(saved.status).toBe(200);
  return { app, userId, hubId: hubRow.id, lvbtOrgId, engineeringOrgId };
}

/** Put two located events on Tuesday with a bus ride between them. */
async function seedTravelDay(userId: string): Promise<void> {
  const [layer] = await db
    .insert(schema.calendarLayer)
    .values({
      userId,
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
  if (!layer) throw new Error('layer seed failed');
  // Tuesday 2026-09-08, 09:00–10:00 and 11:00–12:00 Pacific (16:00/18:00 UTC).
  await db.insert(schema.calendarItem).values([
    {
      userId,
      layerId: layer.id,
      kind: 'native_block',
      provider: 'docket',
      status: 'confirmed',
      syncState: 'clean',
      title: 'Station site visit',
      location: 'Bonneville Transit Center',
      startsAt: new Date('2026-09-08T16:00:00Z'),
      endsAt: new Date('2026-09-08T17:00:00Z'),
      origin: 'user',
    },
    {
      userId,
      layerId: layer.id,
      kind: 'native_block',
      provider: 'docket',
      status: 'confirmed',
      syncState: 'clean',
      title: 'County briefing',
      location: 'Clark County Government Center',
      startsAt: new Date('2026-09-08T18:00:00Z'),
      endsAt: new Date('2026-09-08T19:00:00Z'),
      origin: 'user',
    },
  ]);
}

describe('POST /schedule-week — one run, one week, six kinds of time', () => {
  it('produces a seven-day week containing all six work types from a single invocation', async () => {
    const { app, userId } = await seedPlanner('PlannerSix');
    await seedTravelDay(userId);

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ weekStartDate: WEEK }),
    });
    expect(res.status).toBe(200);
    const plan = (await res.json()) as {
      shapesPresent: string[];
      blocks: { shape: string; origin: string; date: string }[];
      userInputCount: number;
      weekStartDate: string;
      weekEndDate: string;
    };

    expect(plan.shapesPresent).toEqual([
      'filming_session',
      'community_meeting',
      'deep_writing',
      'interstitial_reading',
      'reflection_debrief',
      'architecture_brainstorm',
    ]);
    expect(plan.weekStartDate).toBe(WEEK);
    expect(plan.weekEndDate).toBe('2026-09-13');
    expect(new Set(plan.blocks.map((b) => b.date)).size).toBeGreaterThan(1);
  });

  it('attributes every generated block to the scheduler, with zero created by hand', async () => {
    const { app, userId } = await seedPlanner('PlannerOrigin');
    await seedTravelDay(userId);
    await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ weekStartDate: WEEK }),
    });

    const rows = await db
      .select({ origin: schema.calendarItem.origin, runId: schema.calendarItem.scheduleRunId })
      .from(schema.calendarItem)
      .where(and(eq(schema.calendarItem.userId, userId), isNotNull(schema.calendarItem.workShape)));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.origin === 'scheduler')).toBe(true);
    expect(rows.every((r) => r.runId !== null)).toBe(true);
  });

  it('takes one invocation and asks nothing per item', async () => {
    const { app } = await seedPlanner('PlannerInput');
    const res = await app.request('/', { method: 'POST' });
    expect(res.status).toBe(200);
    const plan = (await res.json()) as { userInputCount: number; blocks: unknown[] };
    expect(plan.userInputCount).toBe(1);
    expect(plan.userInputCount).toBeLessThanOrEqual(3);
    expect(plan.blocks.length).toBeGreaterThan(0);
  });

  it('never destroys a block a person placed by hand, even across regeneration', async () => {
    const { app, userId } = await seedPlanner('PlannerRegen');
    await seedTravelDay(userId);
    await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ weekStartDate: WEEK }),
    });
    await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ weekStartDate: WEEK }),
    });

    const handPlaced = await db
      .select({ id: schema.calendarItem.id, title: schema.calendarItem.title })
      .from(schema.calendarItem)
      .where(and(eq(schema.calendarItem.userId, userId), eq(schema.calendarItem.origin, 'user')));
    expect(handPlaced.map((h) => h.title).sort()).toEqual([
      'County briefing',
      'Station site visit',
    ]);
  });
});

describe('POST /schedule-week — the shapes carry their own constraints', () => {
  it('gives filming a shoot-length block in the LVBT workspace with a location', async () => {
    const { app, lvbtOrgId } = await seedPlanner('PlannerFilming');
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ weekStartDate: WEEK }),
    });
    const plan = (await res.json()) as {
      blocks: {
        shape: string;
        minutes: number;
        organizationId: string | null;
        organizationName: string | null;
        location: string | null;
      }[];
    };
    const filming = plan.blocks.filter((b) => b.shape === 'filming_session');
    expect(filming.length).toBeGreaterThan(0);
    const first = filming[0];
    expect(first?.minutes).toBeGreaterThanOrEqual(90);
    expect(first?.minutes).not.toBe(30);
    expect(first?.organizationId).toBe(lvbtOrgId);
    expect(first?.organizationName).toBe('Las Vegans for Better Transit');
    expect(first?.location).toBe('Bonneville Transit Center');
  });

  it('attaches community-member attendees to LVBT meeting blocks', async () => {
    const { app, lvbtOrgId } = await seedPlanner('PlannerMeeting');
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ weekStartDate: WEEK }),
    });
    const plan = (await res.json()) as {
      blocks: { shape: string; attendees: string[]; organizationId: string | null }[];
    };
    const meetings = plan.blocks.filter((b) => b.shape === 'community_meeting');
    expect(meetings.length).toBeGreaterThan(0);
    expect(meetings[0]?.attendees).toEqual(['rider@example.org', 'organizer@example.org']);
    expect(meetings[0]?.organizationId).toBe(lvbtOrgId);
  });

  it('gives architecture brainstorming a block in the engineering workspace', async () => {
    const { app, engineeringOrgId } = await seedPlanner('PlannerArch');
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ weekStartDate: WEEK }),
    });
    const plan = (await res.json()) as {
      blocks: { shape: string; organizationId: string | null; organizationName: string | null }[];
    };
    const arch = plan.blocks.filter(
      (b) => b.shape === 'architecture_brainstorm' && b.organizationId !== null,
    );
    expect(arch.length).toBeGreaterThan(0);
    expect(arch[0]?.organizationId).toBe(engineeringOrgId);
    expect(arch[0]?.organizationName).toBe('Hypertext Studio');
  });

  it('keeps writing contiguous and at least an hour', async () => {
    const { app } = await seedPlanner('PlannerWriting');
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ weekStartDate: WEEK }),
    });
    const plan = (await res.json()) as {
      blocks: { shape: string; minutes: number; commitmentId: string | null }[];
    };
    const writing = plan.blocks.filter(
      (b) => b.shape === 'deep_writing' && b.commitmentId !== null,
    );
    expect(writing.length).toBeGreaterThan(0);
    for (const block of writing) expect(block.minutes).toBeGreaterThanOrEqual(60);
  });

  it('places reading inside the travel gap between two located events', async () => {
    const { app, userId } = await seedPlanner('PlannerReading');
    await seedTravelDay(userId);
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ weekStartDate: WEEK }),
    });
    const plan = (await res.json()) as {
      blocks: { shape: string; startsAt: string; endsAt: string }[];
    };
    const reading = plan.blocks.filter((b) => b.shape === 'interstitial_reading');
    expect(reading.length).toBeGreaterThan(0);
    const gapStart = Date.parse('2026-09-08T17:00:00Z');
    const gapEnd = Date.parse('2026-09-08T18:00:00Z');
    const inGap = reading.filter(
      (b) => Date.parse(b.startsAt) >= gapStart && Date.parse(b.endsAt) <= gapEnd,
    );
    expect(inGap.length).toBeGreaterThan(0);
  });

  it('links each debrief to the meeting it debriefs with a real calendar relation', async () => {
    const { app, userId } = await seedPlanner('PlannerDebrief');
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ weekStartDate: WEEK }),
    });
    const plan = (await res.json()) as {
      blocks: {
        shape: string;
        calendarItemId: string | null;
        anchorCalendarItemId: string | null;
        date: string;
        startsAt: string;
      }[];
    };
    const debriefs = plan.blocks.filter((b) => b.shape === 'reflection_debrief');
    expect(debriefs.length).toBeGreaterThan(0);

    for (const debrief of debriefs) {
      expect(debrief.anchorCalendarItemId).not.toBeNull();
      const anchor = plan.blocks.find((b) => b.calendarItemId === debrief.anchorCalendarItemId);
      expect(anchor).toBeDefined();
      expect(anchor?.date).toBe(debrief.date);
      expect(Date.parse(debrief.startsAt)).toBeGreaterThanOrEqual(
        Date.parse(anchor?.startsAt ?? '1970-01-01T00:00:00Z'),
      );
    }

    // The link is a real `follow_up` relation, visible to every other calendar surface.
    const relations = await db
      .select()
      .from(schema.calendarItemRelation)
      .where(eq(schema.calendarItemRelation.createdByUserId, userId));
    expect(relations.length).toBeGreaterThanOrEqual(debriefs.length);
    expect(relations.every((r) => r.role === 'follow_up')).toBe(true);
  });

  it('reports a commitment it cannot satisfy instead of silently dropping it', async () => {
    const { app } = await seedPlanner('PlannerUnplaced');
    await app.request('/preferences', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        commitments: [
          {
            shape: 'filming_session',
            title: 'Shoot with no location',
            organizationId: null,
            taskId: null,
            sessionsPerWeek: 1,
            minutesPerSession: null,
            location: null,
            attendees: [],
            active: true,
          },
        ],
      }),
    });
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ weekStartDate: WEEK }),
    });
    const plan = (await res.json()) as { unplaced: { reason: string; title: string }[] };
    expect(plan.unplaced.map((u) => u.reason)).toContain('missing_location');
  });
});

describe('GET /schedule-week — coverage', () => {
  it('reports available versus scheduled minutes with a coverage percentage and no large holes', async () => {
    const { app, userId } = await seedPlanner('PlannerCoverage');
    await seedTravelDay(userId);
    await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ weekStartDate: WEEK }),
    });

    const res = await app.request(`/?weekStartDate=${WEEK}`);
    expect(res.status).toBe(200);
    const plan = (await res.json()) as {
      runId: string | null;
      coverage: {
        availableMinutes: number;
        scheduledMinutes: number;
        coveragePercent: number;
        protectedMinutes: number;
        largestGapMinutes: number;
        gaps: unknown[];
        withinThreshold: boolean;
      };
      blocks: unknown[];
    };

    expect(plan.runId).not.toBeNull();
    expect(plan.blocks.length).toBeGreaterThan(0);
    expect(plan.coverage.availableMinutes).toBeGreaterThan(0);
    expect(plan.coverage.scheduledMinutes).toBeGreaterThan(0);
    expect(plan.coverage.coveragePercent).toBeGreaterThan(0);
    expect(plan.coverage.coveragePercent).toBeLessThanOrEqual(100);
    expect(plan.coverage.largestGapMinutes).toBeLessThanOrEqual(60);
    expect(plan.coverage.gaps).toEqual([]);
    expect(plan.coverage.withinThreshold).toBe(true);
    expect(plan.coverage.protectedMinutes).toBeGreaterThan(0);
  });

  it('never places a work block inside a declared personal window, across ten generated weeks', async () => {
    const { app, userId } = await seedPlanner('PlannerProtected');
    // A single, unmistakable protected window: every Wednesday, all day.
    await app.request('/preferences', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        windows: [
          ...[1, 2, 4, 5].flatMap((weekday) => [
            { weekday, startMinute: 540, endMinute: 1020, kind: 'desk', label: 'Desk' },
            { weekday, startMinute: 1080, endMinute: 1260, kind: 'field', label: 'Field' },
          ]),
          { weekday: 3, startMinute: 0, endMinute: 1439, kind: 'personal', label: 'Wednesday off' },
          { weekday: 6, startMinute: 540, endMinute: 1020, kind: 'field', label: 'Saturday field' },
          { weekday: 0, startMinute: 0, endMinute: 1439, kind: 'personal', label: 'Sunday off' },
        ],
      }),
    });

    const violations: string[] = [];
    for (let week = 0; week < 10; week += 1) {
      const start = new Date(Date.UTC(2026, 8, 7 + week * 7));
      const weekStartDate = start.toISOString().slice(0, 10);
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ weekStartDate }),
      });
      const plan = (await res.json()) as { blocks: { date: string; title: string }[] };
      for (const block of plan.blocks) {
        // Wednesday and Sunday are protected end to end, so no block may fall on them at all.
        const weekday = new Date(`${block.date}T12:00:00Z`).getUTCDay();
        if (weekday === 3 || weekday === 0) violations.push(`${block.date} ${block.title}`);
      }
    }
    expect(violations).toEqual([]);

    const rows = await db
      .select({ startsAt: schema.calendarItem.startsAt })
      .from(schema.calendarItem)
      .where(
        and(eq(schema.calendarItem.userId, userId), eq(schema.calendarItem.origin, 'scheduler')),
      );
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('GET /schedule-week/shapes', () => {
  it('publishes all six shapes with the constraints that make each one different', async () => {
    const { app } = await seedPlanner('PlannerShapes');
    const res = await app.request('/shapes');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      shapes: {
        shape: string;
        placement: string;
        windowKind: string;
        requires: string[];
        splittable: boolean;
      }[];
    };
    expect(body.shapes).toHaveLength(6);

    const byShape = new Map(body.shapes.map((s) => [s.shape, s]));
    expect(byShape.get('filming_session')?.requires).toEqual(['location']);
    expect(byShape.get('filming_session')?.splittable).toBe(false);
    expect(byShape.get('community_meeting')?.requires).toEqual(['attendees']);
    expect(byShape.get('interstitial_reading')?.placement).toBe('interstitial');
    expect(byShape.get('interstitial_reading')?.windowKind).toBe('transit');
    expect(byShape.get('reflection_debrief')?.placement).toBe('anchored_after');
    expect(byShape.get('deep_writing')?.splittable).toBe(false);
  });
});
