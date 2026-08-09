/**
 * `@docket/api` — weekly auto-scheduling router (TOP-LEVEL, mounted at `/v1/schedule-week`).
 *
 * @remarks
 * A cross-org, personal surface, like the daily plan: it reads `c.get('session')` directly and
 * resolves the caller's Hub from `hub.userId`. A week is planned for a *person*, and the whole
 * value is that one run covers every workspace they work in at once, so there is no `orgId`
 * anywhere in this router.
 *
 * `POST /` is the entire generation surface: no body is required, nothing is asked per item, and
 * the response reports `userInputCount` so the "extremely little input" claim is a number in the
 * payload rather than an assertion in a document.
 */
import { db, genId, hub } from '@docket/db';
import type { SchedulingCommitment } from '@docket/types';
import {
  SchedulingPreferencesOut,
  SchedulingPreferencesUpdate,
  WeekPlanGenerateInput,
  WeekPlanOut,
  WeekPlanQuery,
  WorkShapeProfile,
  WORK_SHAPES,
  WORK_SHAPE_PROFILES,
} from '@docket/types';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { AuthError, NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zQuery } from '../lib/validate';
import {
  latestRunForWeek,
  loadBusyItems,
  loadOrganizationNames,
  loadSchedulingPreferences,
  loadWeekBlocks,
  saveSchedulingPreferences,
  weekBounds,
} from '../services/scheduling/repository';
import { generateWeek, toWeekPlan } from '../services/scheduling/week-service';
import { planWeek } from '../services/scheduling/week-planner';
import { EMPTY_ACTUALS } from '../services/scheduling/duration-model';
import { localDateString, weekStartOf } from '../services/scheduling/zoned-time';

/** Resolve (or 404) the caller's Hub from the session user. */
async function resolveHub(userId: string): Promise<{ hubId: string }> {
  const rows = await db.select({ id: hub.id }).from(hub).where(eq(hub.userId, userId)).limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Hub not found');
  return { hubId: row.id };
}

/** The complete work-shape taxonomy, so a client never restates a constraint. */
const WorkShapeCatalogOut = z.object({ shapes: z.array(WorkShapeProfile) }).meta({
  id: 'WorkShapeCatalogOut',
  description:
    'Every work shape the scheduler knows and the constraints that make each one placed differently.',
});

/** Weekly auto-scheduling router. */
const scheduleWeek = new Hono<AppEnv>()
  .get(
    '/shapes',
    apiDoc({
      tag: 'Scheduling',
      summary: 'List the work-shape taxonomy',
      response: WorkShapeCatalogOut,
      description: `Return the six work shapes the weekly planner understands, each with its full placement profile: whether it must be contiguous, which kind of availability window it consumes, its minimum/default/maximum session length, what it requires to be well-formed (a location, attendees, a source event), and whether it may absorb leftover time.

This is a **read of a compile-time constant**, not of the caller's data, so it is side-effect-free and identical for every caller. It exists so a client can render and validate shapes without restating any of these constraints — the planner and the UI read the same table.

Session-only, no capability. 401 when unauthenticated.`,
    }),
    (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      return ok(c, WorkShapeCatalogOut, {
        shapes: Object.values(WORK_SHAPE_PROFILES),
      });
    },
  )
  .get(
    '/preferences',
    apiDoc({
      tag: 'Scheduling',
      summary: 'Read scheduling preferences',
      response: SchedulingPreferencesOut,
      description: `Return the caller's availability model (recurring weekly desk/field/transit/personal windows), their standing weekly commitments, and the planner policy (whether meetings automatically earn a debrief, which shapes may absorb slack, and the gap/travel thresholds).

**Documented defaults, not hidden fallbacks:** a caller who has never saved preferences gets a complete, usable model back with \`configured: false\` — weekday desk hours with a protected lunch, protected evenings and Sundays, Saturday field time, and weekday commute windows. That is what lets the very first planning run produce a real week; every value in it is visible here and editable via \`PUT /preferences\`.

Session-only, no capability. 401 when unauthenticated; **404 (Hub not found)** if the session user has no Hub row. Side-effect-free read.`,
    }),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const { hubId } = await resolveHub(session.user.id);
      const preferences = await loadSchedulingPreferences(db, hubId);
      return ok(c, SchedulingPreferencesOut, serializePreferences(preferences));
    },
  )
  .put(
    '/preferences',
    apiDoc({
      tag: 'Scheduling',
      summary: 'Update scheduling preferences',
      response: SchedulingPreferencesOut,
      description: `Replace any subset of the caller's scheduling configuration. Every provided field replaces its value wholesale (the arrays are documents, not patch sets); omitted fields keep their current value.

**This is the setup surface, and it is the only place per-item input ever happens.** Commitments written here are standing — "two filming sessions a week at this location", "meet community members twice a week with these people" — so a later \`POST /\` needs no arguments at all and asks nothing. \`backfillShapes\` is filtered to backfill-eligible shapes on write, so an ineligible choice cannot silently linger in stored configuration.

**Side effect:** upserts the caller's \`scheduling_preference\` row. Commitments arriving without an \`id\` are assigned one. Session-only, no capability; 401 when unauthenticated, 404 if the caller has no Hub.`,
    }),
    zJson(SchedulingPreferencesUpdate),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const { hubId } = await resolveHub(session.user.id);
      const body = c.req.valid('json');
      const newIds = Array.from({ length: body.commitments?.length ?? 0 }, () => genId());
      const saved = await saveSchedulingPreferences(db, hubId, body, newIds);
      return ok(c, SchedulingPreferencesOut, serializePreferences(saved));
    },
  )
  .post(
    '/',
    apiDoc({
      tag: 'Scheduling',
      summary: 'Generate a scheduled week',
      response: WeekPlanOut,
      description: `Plan one week end to end and write it to the caller's calendar. **The body is optional in its entirety** — with no body at all this plans the current week in the Hub timezone, reading availability, standing commitments, what is already booked, and the Time Ledger's own measured session lengths for itself. There is no per-item prompt and no confirmation step anywhere in the call path; the response's \`userInputCount\` records how many explicit interactions the run consumed (1).

Each of the six work shapes is placed by its own rule: shoots and community meetings claim field windows first (longest first, and a meeting is only placed somewhere its debrief also fits); writing and architecture take contiguous desk windows and are never fragmented; a debrief is derived after every meeting-shaped block and after every pre-existing event with attendees, linked to it with a \`follow_up\` calendar relation; reading is placed **only** into travel/waiting gaps, which are inferred from consecutive commitments in different locations rather than declared; and whatever the person allowed to absorb slack fills the largest remaining holes until none exceeds their threshold.

**Protected time is unreachable, structurally:** \`personal\` windows are subtracted from availability before the planner runs, so no pass can place work there — including a travel gap that happens to land in a protected lunch.

**Side effects:** inserts one \`schedule_run\` row and one \`calendar_item\` per placed block, each carrying \`origin: 'scheduler'\`, its \`work_shape\`, and the run id. Unless \`replaceExisting\` is false, the **scheduler's own** blocks for that week are cleared first — a block a person created by hand is never touched. \`dryRun: true\` computes and returns the identical week and writes nothing.

Anything that could not be placed is returned in \`unplaced\` with a stable reason code (\`missing_location\`, \`missing_attendees\`, \`no_matching_window\`, \`week_full\`), never silently dropped. Session-only, no capability; 401 when unauthenticated, 404 if the caller has no Hub. Related: \`GET /\` to re-read a generated week, \`PUT /preferences\` to change the inputs.`,
    }),
    zJson(WeekPlanGenerateInput.optional()),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const { hubId } = await resolveHub(session.user.id);
      const body = c.req.valid('json') ?? {};
      const plan = await generateWeek(db, {
        hubId,
        userId: session.user.id,
        ...(body.weekStartDate !== undefined ? { weekStartDate: body.weekStartDate } : {}),
        ...(body.dryRun !== undefined ? { dryRun: body.dryRun } : {}),
        ...(body.replaceExisting !== undefined ? { replaceExisting: body.replaceExisting } : {}),
      });
      return ok(c, WeekPlanOut, plan);
    },
  )
  .get(
    '/',
    apiDoc({
      tag: 'Scheduling',
      summary: 'Read a generated week',
      response: WeekPlanOut,
      description: `Return the week as it currently stands on the calendar, with the same coverage report \`POST /\` produced: total available minutes inside declared windows, minutes actually carrying a plan, coverage as a percentage, protected minutes deliberately left alone, every remaining gap above the caller's threshold, and the longest one.

**Read from the calendar, not from a cached plan.** The blocks returned are the live \`calendar_item\` rows, so a block the person has since moved, completed or deleted is reflected here — which is what makes the coverage figure a statement about the week rather than about the run that produced it. \`runId\` names the most recent planning run covering the week, or null if the week was never generated.

\`weekStartDate\` defaults to the current week in the Hub timezone and is normalized to that week's local Monday. Side-effect-free. Session-only, no capability; 401 when unauthenticated, 404 if the caller has no Hub.`,
    }),
    zQuery(WeekPlanQuery),
    async (c) => {
      const session = c.get('session');
      if (!session?.user) throw new AuthError();
      const { hubId } = await resolveHub(session.user.id);
      const { weekStartDate } = c.req.valid('query');
      const preferences = await loadSchedulingPreferences(db, hubId);
      const now = new Date();
      const week = weekStartOf(weekStartDate ?? localDateString(now, preferences.timezone));
      const bounds = weekBounds(week, preferences.timezone);
      const busy = await loadBusyItems(db, session.user.id, bounds);

      // Replay the planner over the week as it actually is: everything on the calendar counts as
      // busy, so the coverage figure describes reality rather than the last run's intentions.
      const replay = planWeek({
        weekStartDate: week,
        timezone: preferences.timezone,
        windows: preferences.windows,
        commitments: [],
        busy,
        actuals: EMPTY_ACTUALS,
        reflectionForMeetings: false,
        backfillShapes: [],
        maxUnplannedGapMinutes: preferences.maxUnplannedGapMinutes,
        minTransitGapMinutes: preferences.minTransitGapMinutes,
        maxTransitGapMinutes: preferences.maxTransitGapMinutes,
      });

      const run = await latestRunForWeek(db, hubId, week);
      const weekBlocks = await loadWeekBlocks(db, session.user.id, bounds, preferences.timezone);
      const orgNames = await loadOrganizationNames(
        db,
        weekBlocks.flatMap((b) => (b.organizationId === null ? [] : [b.organizationId])),
      );
      const blocks: z.input<typeof WeekPlanOut>['blocks'] = weekBlocks.map((b) => ({
        calendarItemId: b.calendarItemId,
        shape: b.shape,
        shapeLabel: WORK_SHAPE_PROFILES[b.shape].label,
        title: b.title,
        startsAt: new Date(b.start).toISOString(),
        endsAt: new Date(b.end).toISOString(),
        date: b.date,
        minutes: Math.round((b.end - b.start) / 60_000),
        organizationId: b.organizationId,
        organizationName:
          b.organizationId === null ? null : (orgNames.get(b.organizationId) ?? null),
        location: b.location,
        attendees: [...b.attendees],
        origin: b.origin as z.input<typeof WeekPlanOut>['blocks'][number]['origin'],
        anchorCalendarItemId: b.anchorCalendarItemId,
        commitmentId: null,
        durationSource: 'requested',
      }));

      const plan = toWeekPlan({
        runId: run?.id ?? null,
        weekStartDate: week,
        preferences,
        result: { ...replay, blocks: [] },
        persistedIds: new Map(),
        orgNames,
        generatedAt: run?.generatedAt ?? now,
        dryRun: false,
      });
      return ok(c, WeekPlanOut, {
        ...plan,
        blocks,
        shapesPresent: distinctShapes(blocks),
        unplaced: (run?.unplaced ?? []) as typeof plan.unplaced,
      });
    },
  );

/** Serialize resolved preferences for the wire. */
function serializePreferences(
  preferences: Awaited<ReturnType<typeof loadSchedulingPreferences>>,
): z.input<typeof SchedulingPreferencesOut> {
  return {
    hubId: preferences.hubId,
    timezone: preferences.timezone,
    windows: preferences.windows.map((w) => ({ ...w })),
    commitments: preferences.commitments.map(
      (commitment): z.input<typeof SchedulingCommitment> => ({
        ...commitment,
        attendees: [...commitment.attendees],
      }),
    ),
    reflectionForMeetings: preferences.reflectionForMeetings,
    backfillShapes: [...preferences.backfillShapes],
    checkInCadenceMinutes: preferences.checkInCadenceMinutes,
    autoReorganizeOnDrift: preferences.autoReorganizeOnDrift,
    maxUnplannedGapMinutes: preferences.maxUnplannedGapMinutes,
    minTransitGapMinutes: preferences.minTransitGapMinutes,
    maxTransitGapMinutes: preferences.maxTransitGapMinutes,
    configured: preferences.configured,
  };
}

/** The shapes present in a set of serialized blocks, in taxonomy order. */
function distinctShapes(
  blocks: z.input<typeof WeekPlanOut>['blocks'],
): z.input<typeof WeekPlanOut>['shapesPresent'] {
  const present = new Set(blocks.map((b) => b.shape));
  return WORK_SHAPES.filter((s) => present.has(s));
}

export default scheduleWeek;
