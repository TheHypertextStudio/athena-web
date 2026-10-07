import { eq } from 'drizzle-orm';
import directiveFeed from '../../src/routes/schedule-week-directive';
import scheduleWeek from '../../src/routes/schedule-week';
import { appWithSession, fakeSession, getDb, seedUserWithHub } from './routes-harness';

const TZ = 'America/Los_Angeles';
/** A Monday, and the Tuesday inside that week. */
const WEEK = '2026-10-05';

interface Fixture {
  readonly directive: ReturnType<typeof appWithSession>;
  readonly planner: ReturnType<typeof appWithSession>;
  readonly userId: string;
  readonly hubId: string;
}

/** Seed a person with a planned week, so the day loop has a real day to run against. */
export async function seedDay(label: string, options: { plan?: boolean } = {}): Promise<Fixture> {
  const schema = await getDb();
  const db = schema.db;
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
    if (res.status !== 200) throw new Error('Could not seed a planned week');
  }

  return { directive, planner, userId, hubId: hubRow.id };
}
