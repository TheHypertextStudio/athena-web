/**
 * The Initiative roadmap read: Program lanes and dated Project bars.
 *
 * @remarks
 * Split from the Initiative record contract because it is one endpoint's response shape rather
 * than part of the record — `GET /:initiativeId/timeline` and nothing else. Re-exported from
 * `initiative.ts` so importers do not have to care which file a name lives in.
 */
import { z } from 'zod';

import { DateResolution } from '../planning-timeframe';
import { Health } from './capability';
import { ProgramId, ProjectId } from '../ids';

/**
 * One timeline bar for an associated Project (a bounded, dated effort).
 *
 * @remarks
 * The roadmap-first roll-up (api-rpc-contract §3.3 `GET /:initiativeId/timeline`): each
 * associated Project becomes a dated bar with its current `status`/`health`. `startDate`
 * and `targetDate` may be null when the Project has not been scheduled. Each endpoint carries its
 * broad resolution and saved fiscal basis so clients can describe the period without exposing the
 * canonical geometry boundary as if it were a precise day.
 */
export const InitiativeTimelineBar = z
  .object({
    id: ProjectId.describe('The associated Project this bar represents.'),
    name: z.string().describe('The Project’s display name.'),
    status: z
      .string()
      .describe('The Project’s lifecycle status (`planned`/`active`/`completed`/`canceled`).'),
    health: Health.nullable().describe('The Project’s health verdict, or `null` when unset.'),
    startDate: z
      .string()
      .nullable()
      .describe('ISO start date (the bar’s left edge), or `null` when the Project is unscheduled.'),
    startDateResolution: DateResolution.nullable().describe(
      'Broad start resolution, or `null` when the start is a precise day or unset.',
    ),
    startDateFiscalYearStartMonth: z
      .number()
      .int()
      .min(0)
      .max(11)
      .nullable()
      .describe('Saved zero-based fiscal basis for a broad start value.'),
    targetDate: z
      .string()
      .nullable()
      .describe('ISO target/end date (the bar’s right edge), or `null` when unscheduled.'),
    targetDateResolution: DateResolution.nullable().describe(
      'Broad target resolution, or `null` when the target is a precise day or unset.',
    ),
    targetDateFiscalYearStartMonth: z
      .number()
      .int()
      .min(0)
      .max(11)
      .nullable()
      .describe('Saved zero-based fiscal basis for a broad target value.'),
  })
  .meta({ id: 'InitiativeTimelineBar', description: 'A project bar on an initiative timeline.' });
/** Initiative timeline project-bar value. */
export type InitiativeTimelineBar = z.infer<typeof InitiativeTimelineBar>;

/**
 * One timeline lane for an associated Program (an ongoing area of operations).
 *
 * @remarks
 * Programs have no end state, so a lane carries no end date — only its identity, current
 * `status`, and `health`. Lanes render above the Project bars on the roadmap.
 */
export const InitiativeTimelineLane = z
  .object({
    id: ProgramId.describe('The associated Program this lane represents.'),
    name: z.string().describe('The Program’s display name.'),
    status: z.string().describe('The Program’s status (`active`/`paused`/`archived`).'),
    health: Health.nullable().describe('The Program’s health verdict, or `null` when unset.'),
  })
  .meta({ id: 'InitiativeTimelineLane', description: 'A program lane on an initiative timeline.' });
/** Initiative timeline program-lane value. */
export type InitiativeTimelineLane = z.infer<typeof InitiativeTimelineLane>;

/**
 * The roadmap-first timeline roll-up for an Initiative: its Program lanes + Project bars.
 *
 * @remarks
 * Returned by `GET /:initiativeId/timeline`. The optional `from`/`to` query window filters
 * the Project bars to those that overlap the window (a Project overlaps when it has no
 * dates, or its `[startDate, targetDate]` intersects `[from, to]`); Program lanes are
 * always returned (they are ongoing and undated).
 */
export const InitiativeTimelineOut = z
  .object({
    programs: z
      .array(InitiativeTimelineLane)
      .describe(
        'Ongoing, undated Program lanes associated with the Initiative — always returned in full (not windowed).',
      ),
    projects: z
      .array(InitiativeTimelineBar)
      .describe(
        'Dated Project bars associated with the Initiative, filtered to those overlapping the optional `from`/`to` window (unscheduled projects always included).',
      ),
  })
  .meta({ id: 'InitiativeTimelineOut', description: 'An initiative roadmap roll-up.' });
/** Initiative timeline value. */
export type InitiativeTimelineOut = z.infer<typeof InitiativeTimelineOut>;

/** Query window for the Initiative timeline (both bounds optional ISO dates). */
export const InitiativeTimelineQuery = z
  .object({
    from: z.iso
      .date()
      .optional()
      .describe(
        'Lower bound (ISO-8601 `YYYY-MM-DD`) of the window. Open when omitted. Filters Project bars only.',
      ),
    to: z.iso
      .date()
      .optional()
      .describe(
        'Upper bound (ISO-8601 `YYYY-MM-DD`) of the window (inclusive through end-of-day). Open when omitted. Filters Project bars only.',
      ),
  })
  .meta({ id: 'InitiativeTimelineQuery', description: 'Initiative timeline window query.' });
/** Validated initiative-timeline query value. */
export type InitiativeTimelineQuery = z.infer<typeof InitiativeTimelineQuery>;
