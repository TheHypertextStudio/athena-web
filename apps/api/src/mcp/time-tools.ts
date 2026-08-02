/**
 * `@docket/api` — the `track` tool: the universal timer over MCP.
 *
 * @remarks
 * One tool with an `action`, not seven tools, because the timer is one object with a lifecycle.
 * Seven registrations would make an assistant choose between `start_timer`, `resume_timer` and
 * `switch_timer` on every turn — three names for the same intent, distinguishable only by state
 * the assistant cannot see. With one verb and an enum, the model asks for what the person said
 * ("start tracking the migration") and the server decides whether that is a start, a resume or a
 * switch, exactly as the REST surface does.
 *
 * The tool is a client of the same commands the REST routes call. Nothing about the ledger's
 * rules — task anchoring, the sub-minute join, the naming guard, event emission — is reimplemented
 * here, so MCP cannot drift into a second, laxer timer.
 *
 * Tracking is personal, so this tool is only available to a **user** principal. An org-registered
 * agent has no Hub and no personal ledger; letting one start "its own" timer would silently write
 * time into whichever human happened to be nearby.
 */
import { db, task } from '@docket/db';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import type { McpContext } from './auth';
import type { McpRegistrar } from './catalog';
import { errorResult, jsonResult, runTool } from './result';
import { requireScope } from './scope';
import {
  createTimeRecord,
  getActiveTime,
  getTimeTimeline,
  pauseTimeRecord,
  startTimeRecord,
  stopTimeRecord,
} from '../time/service';

/** The lifecycle verbs `track` accepts. */
const TRACK_ACTIONS = ['start', 'pause', 'resume', 'switch', 'stop', 'status', 'segments'] as const;

/** One segment as an assistant sees it. */
const SEGMENT_SHAPE = z.object({
  taskId: z.string(),
  taskTitle: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  durationMs: z.number(),
  running: z.boolean(),
});

/** The tracker as an assistant sees it. */
const TRACKING_SHAPE = z.object({
  state: z.enum(['running', 'paused', 'idle']),
  timeRecordId: z.string().nullable(),
  taskId: z.string().nullable(),
  taskTitle: z.string().nullable(),
  startedAt: z.string().nullable(),
  trackedMs: z.number(),
});

/** Project a hydrated record onto the assistant-facing tracking shape. */
function toTracking(
  record: Awaited<ReturnType<typeof createTimeRecord>> | null,
): z.infer<typeof TRACKING_SHAPE> {
  if (!record) {
    return {
      state: 'idle',
      timeRecordId: null,
      taskId: null,
      taskTitle: null,
      startedAt: null,
      trackedMs: 0,
    };
  }
  const running = record.intervals.some((interval) => interval.endedAt === null);
  return {
    state: running ? 'running' : record.status === 'closed' ? 'idle' : 'paused',
    timeRecordId: record.id,
    taskId: record.taskId,
    taskTitle: record.title,
    startedAt: record.startedAt,
    trackedMs: record.measures.humanEffortMs,
  };
}

/** Resolve which record an action applies to: the named one, or whatever is tracking now. */
async function resolveTargetRecordId(
  userId: string,
  explicit: string | undefined,
): Promise<string | null> {
  if (explicit) return explicit;
  const active = await getActiveTime(userId);
  return active.record?.id ?? null;
}

/** Register `track` on `server`. */
export function registerTimeTools(server: McpRegistrar, ctx: McpContext): void {
  server.registerTool(
    'track',
    {
      title: 'Track time',
      description:
        'The universal timer. Start tracking a task (by `taskId`, or by `label` alone — which creates an ordinary Docket task with that name), pause and resume it, switch to different work, stop it, read what is running, or list the segments recorded in a period. Restarting the same task within a minute continues the previous segment instead of recording a break. A session can never be finished without a named task.',
      inputSchema: {
        action: z
          .enum(TRACK_ACTIONS)
          .describe(
            'start = begin tracking (switching away from anything running); pause/resume/stop act on the running timer; switch = start on different work; status = what is running now; segments = what was recorded in a period.',
          ),
        taskId: z
          .string()
          .optional()
          .describe('The Docket task to track. Required for `switch`; optional for `start`.'),
        label: z
          .string()
          .optional()
          .describe(
            'What is being worked on, in the person’s words. Required when starting without a `taskId` — it becomes the new task’s title.',
          ),
        orgId: z
          .string()
          .optional()
          .describe('Where to create the task when starting from a `label`. Defaults to personal.'),
        timeRecordId: z
          .string()
          .optional()
          .describe('Act on a specific session instead of whatever is currently running.'),
        start: z.string().optional().describe('ISO-8601 start of the `segments` period.'),
        end: z.string().optional().describe('ISO-8601 end of the `segments` period.'),
      },
      outputSchema: {
        tracking: TRACKING_SHAPE.describe('The tracker after the action (or as it stands).'),
        segments: z
          .array(SEGMENT_SHAPE)
          .optional()
          .describe('Only for `segments`: every recorded segment overlapping the period.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (args: {
      action: (typeof TRACK_ACTIONS)[number];
      taskId?: string;
      label?: string;
      orgId?: string;
      timeRecordId?: string;
      start?: string;
      end?: string;
    }) =>
      runTool(async () => {
        requireScope(
          ctx.scopes,
          args.action === 'status' || args.action === 'segments' ? 'work:read' : 'work:write',
        );
        if (ctx.principal.kind !== 'user') {
          return errorResult(
            'Time tracking belongs to a person, not to an agent. Ask the person to start their own timer.',
          );
        }
        const userId = ctx.principal.userId;

        if (args.action === 'status') {
          const active = await getActiveTime(userId);
          return jsonResult({ tracking: toTracking(active.record) });
        }

        if (args.action === 'segments') {
          if (!args.start || !args.end) {
            return errorResult('Listing segments needs both `start` and `end`.');
          }
          const records = await getTimeTimeline(userId, { start: args.start, end: args.end });
          const taskIds = [...new Set(records.map((record) => record.taskId))];
          const titles = new Map(
            taskIds.length > 0
              ? (
                  await db
                    .select({ id: task.id, title: task.title })
                    .from(task)
                    .where(inArray(task.id, taskIds))
                ).map((row) => [row.id, row.title] as const)
              : [],
          );
          const segments = records
            .flatMap((record) =>
              record.intervals
                .filter((interval) => interval.supersededById === null)
                .map((interval) => ({
                  taskId: interval.taskId,
                  taskTitle: titles.get(interval.taskId) ?? record.title,
                  startedAt: interval.startedAt,
                  endedAt: interval.endedAt,
                  durationMs:
                    (interval.endedAt ? Date.parse(interval.endedAt) : Date.now()) -
                    Date.parse(interval.startedAt),
                  running: interval.endedAt === null,
                })),
            )
            .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
          const active = await getActiveTime(userId);
          return jsonResult({ tracking: toTracking(active.record), segments });
        }

        if (args.action === 'start' || args.action === 'switch') {
          if (args.action === 'switch' && !args.taskId && !args.label) {
            return errorResult('Switching needs the task to switch to — pass `taskId` or `label`.');
          }
          const label = args.label ?? (await taskTitle(args.taskId));
          if (!label) return errorResult('Say what is being worked on — pass `label` or `taskId`.');
          const record = await createTimeRecord(userId, {
            context: {
              label,
              ...(args.taskId ? { taskId: args.taskId } : {}),
              ...(args.orgId ? { organizationId: args.orgId } : {}),
              contextualRefs: [],
            },
            startNow: true,
          });
          return jsonResult({ tracking: toTracking(record) });
        }

        const recordId = await resolveTargetRecordId(userId, args.timeRecordId);
        if (!recordId) return errorResult('Nothing is being tracked right now.');
        const record =
          args.action === 'pause'
            ? await pauseTimeRecord(userId, recordId)
            : args.action === 'resume'
              ? await startTimeRecord(userId, recordId)
              : await stopTimeRecord(userId, recordId);
        return jsonResult({ tracking: toTracking(record) });
      }),
  );
}

/** Read a task's own title so an assistant need not repeat it back to start tracking. */
async function taskTitle(taskId: string | undefined): Promise<string | null> {
  if (!taskId) return null;
  const rows = await db
    .select({ title: task.title })
    .from(task)
    .where(eq(task.id, taskId))
    .limit(1);
  return rows[0]?.title ?? null;
}
