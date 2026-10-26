import { z } from 'zod';
import { WIDGET, widgetMeta } from './apps';
import type { McpContext } from './auth';
import type { McpRegistrar } from './catalog';
import { resolveTimeHubId } from '../time/access';
import { NotFoundError } from '../error';
import { authorize, jsonResult, runTool, scopedActor } from './result';
import { orgIdParam } from './tools-shared';
import { readWorkload } from '../workload/repository';

const timezone = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Choose a valid IANA timezone.');

/** Register the read-only personal workload view and its standard MCP App resource linkage. */
export function registerWorkloadTool(server: McpRegistrar, ctx: McpContext): void {
  server.registerTool(
    'view_workload',
    {
      title: 'Daily workload',
      description:
        'Read personal workload: plans, tracked time, unknown estimates and daily headroom. Overlap counts once; excludes meetings. Headroom is not free calendar time.\n\nRead personal daily workload: visible workspace plans, tracked time, unknown estimates, and headroom against a full-day budget. Overlap counts once. Read-only; excludes meetings and other workspaces. Headroom is not free calendar time.',
      inputSchema: {
        orgId: orgIdParam,
        date: z.iso.date().describe('Local calendar date, YYYY-MM-DD.'),
        timezone: timezone.describe('IANA timezone for calendar-day boundaries.'),
        availableHours: z
          .number()
          .min(0)
          .max(24)
          .default(8)
          .describe('Full-day budget; defaults to8h. Changes only this view.'),
      },
      outputSchema: {
        date: z.string(),
        timezone: z.string(),
        orgId: z.string(),
        workspaceName: z.string(),
        availableHours: z.number(),
        asOf: z.string(),
        dayStartsAt: z.string(),
        dayEndsAt: z.string(),
        tasks: z.array(
          z.looseObject({
            id: z.string(),
            title: z.string(),
            plannedMinutes: z.number().nullable(),
            trackedMinutes: z.number(),
          }),
        ),
        totals: z.record(z.string(), z.number().nullable()),
      },
      _meta: widgetMeta(WIDGET.workload),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(async () => {
        const actor = await scopedActor(ctx, input.orgId, 'work:read');
        await authorize(actor, 'view', {
          kind: 'organization',
          id: input.orgId,
          orgId: input.orgId,
        });
        if (ctx.principal.kind !== 'user') throw new NotFoundError('Hub not found');
        const userId = ctx.principal.userId;
        const hubId = await resolveTimeHubId(userId);
        return jsonResult(
          await readWorkload({
            ...input,
            actorId: actor.actorId,
            userId,
            hubId,
          }),
        );
      }),
  );
}
