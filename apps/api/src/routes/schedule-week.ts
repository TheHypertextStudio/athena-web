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
import type { SchedulingCommitment } from '@docket/planning/scheduling-contract';
import {
  SchedulingPreferencesOut,
  SchedulingPreferencesUpdate,
  WeekPlanGenerateInput,
  WeekPlanOut,
  WeekPlanQuery,
  WorkShapeProfile,
  WORK_SHAPES,
  WORK_SHAPE_PROFILES,
} from '@docket/planning/scheduling-contract';
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
import { localDateString, weekStartOf } from '@docket/planning/zoned-time';

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

Session-only, no capability. Returns 401 when unauthenticated and 404 when the caller has no Hub. This read has no side effects.`,
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

Commitments saved here are standing instructions, such as two filming sessions per week at one location. A later \`POST /\` uses these preferences and needs no request body. Docket removes choices from \`backfillShapes\` when the selected shape does not support backfill.

The operation saves the complete preference set. Commitments without an \`id\` receive one. Session-only, no capability. Returns 401 when unauthenticated and 404 when the caller has no Hub.`,
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
      description: `Generate a weekly plan and add its scheduled blocks to the caller's calendar. The request body is optional. When omitted, Docket plans the current week in the Hub timezone using saved availability, existing calendar items, scheduling preferences, and measured work durations.

Docket keeps personal windows free. It places field work and meetings before desk work, keeps writing and architecture blocks contiguous, adds debriefs after meetings, and uses travel or waiting gaps for reading. The response lists work that could not be scheduled in \`unplaced\` with one of these reason codes: \`missing_location\`, \`missing_attendees\`, \`no_matching_window\`, or \`week_full\`.

By default, Docket replaces blocks that a previous scheduler run created for the same week. It never removes hand-created or externally synced calendar items. Set \`replaceExisting: false\` to keep earlier scheduled blocks. Set \`dryRun: true\` to return the proposed plan without changing the calendar.`,
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
      description: `Return the current calendar plan and coverage for one week. Coverage includes available minutes, planned minutes, percentage covered, protected minutes, remaining gaps above the caller's threshold, and the longest gap.

The response reflects current calendar items, including changes made after the scheduling run. \`runId\` identifies the most recent planning run for the week or is null when the week has never been generated. \`weekStartDate\` defaults to the current week in the Hub timezone and is normalized to that week's local Monday. This operation does not change the calendar.`,
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
