/** Permission-filtered template discovery for clients that expose only MCP tools. */
import { TeamId } from '@docket/identity-access/ids';
import { listWorkTemplates } from '../lib/templates/service';
import { toWorkTemplateOut } from '../lib/templates/projection';
import { TemplateOut, TemplateTargetType } from '@docket/work/template-contract';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { z } from 'zod';

import { ValidationError } from '../error';
import { seedDefaultTemplates } from '../lib/templates/defaults';
import { toTemplateOut } from '../lib/templates/write';
import type { McpContext } from './auth';
import type { McpRegistrar } from './catalog';
import { createCursorCodec } from './cursors';
import { authorize, jsonResult, runTool, scopedActor } from './result';
import { orgIdParam } from './tools-shared';

const cursorCodec = createCursorCodec({
  payloadSchema: z.object({
    orgId: z.string(),
    actorId: z.string(),
    targetType: TemplateTargetType.nullable(),
    teamId: z.string().nullable(),
    after: z.string(),
  }),
  invalidCursorError: () =>
    new ValidationError([{ path: ['cursor'], message: 'Invalid template cursor.' }]),
  secretMissingError: () => new Error('Template cursor signing is unavailable'),
});

/** The catalog contract names the tools that consume each returned draft. */
const definition = {
  title: 'List templates',
  description:
    'Read available work types and template bodies. Fill payload.description. Select workTypeId/version for creation, or give withoutTemplateReason.\n\nRead published work types, blank bases and readable legacy drafts. Fill payload.description, not the usage summary. Creation accepts workTypeId/version or a legacy reference; explicit fields win and withoutTemplateReason opts out. Draft planning applies defaults; define_template authors templates.',
  inputSchema: {
    orgId: orgIdParam,
    targetType: TemplateTargetType.optional().describe(
      'Only templates for this kind of work. Match it to the plan node kind; repeat_task requires task.',
    ),
    teamId: TeamId.optional().describe('Offer templates for this destination team.'),
    limit: z.number().int().min(1).max(100).default(50),
    cursor: z
      .string()
      .optional()
      .describe(
        'The nextCursor from the preceding page. Keep orgId, targetType and teamId unchanged.',
      ),
  },
  outputSchema: {
    templates: z
      .array(
        TemplateOut.extend({
          revision: z.number().int().nonnegative(),
          offeredTeamIds: z.array(TeamId),
          versionNumber: z.number().int().positive().nullable(),
          draftDefinition: WorkTemplateDefinition.optional(),
        }),
      )
      .describe(
        'Published templates and readable legacy drafts; team drafts apply only on their teamId.',
      ),
    nextCursor: z
      .string()
      .nullable()
      .describe('Pass as cursor for more templates; null ends the list.'),
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

/** Bind discovery pagination to the authorized caller and exact destination filters. */
function validateCursor(
  cursor: ReturnType<typeof cursorCodec.decode> | undefined,
  input: {
    orgId: string;
    actorId: string;
    targetType?: string | undefined;
    teamId?: string | undefined;
  },
): void {
  if (!cursor) return;
  if (
    cursor.orgId !== input.orgId ||
    cursor.actorId !== input.actorId ||
    cursor.targetType !== (input.targetType ?? null) ||
    cursor.teamId !== (input.teamId ?? null)
  ) {
    throw new ValidationError([
      {
        path: ['cursor'],
        message: 'The template cursor belongs to another caller, workspace, or filter.',
      },
    ]);
  }
}

/** Register read-only template discovery with signed pagination bound to the actor and filters. */
export function registerTemplateDiscoveryTool(server: McpRegistrar, ctx: McpContext): void {
  server.registerTool('list_templates', definition, (input) =>
    runTool(async () => {
      const actor = await scopedActor(ctx, input.orgId, 'work:read');
      await authorize(actor, 'view', {
        kind: 'organization',
        id: input.orgId,
        orgId: input.orgId,
      });
      const cursor = input.cursor ? cursorCodec.decode(input.cursor) : undefined;
      validateCursor(cursor, { ...input, actorId: actor.actorId });
      await seedDefaultTemplates(input.orgId, actor.actorId);
      const catalog = await listWorkTemplates(
        { orgId: input.orgId, actorId: actor.actorId },
        { targetType: input.targetType, teamId: input.teamId, includeDrafts: 'true' },
      );
      const rows = catalog
        .filter(
          (row) =>
            (!input.teamId || row.scope !== 'team' || row.teamId === input.teamId) &&
            (!cursor || row.id > cursor.after),
        )
        .slice(0, input.limit + 1);
      const page = rows.slice(0, input.limit);
      const templates = await Promise.all(
        page.map(async (row) => {
          const legacy = toTemplateOut(row);
          const projection = await toWorkTemplateOut(
            { orgId: input.orgId, actorId: actor.actorId },
            row,
          );
          return {
            ...legacy,
            revision: projection.revision,
            offeredTeamIds: projection.offeredTeamIds,
            versionNumber: projection.latestVersion?.number ?? null,
            ...(row.isBase ? { name: projection.definition.name } : {}),
            ...(projection.draftDefinition ? { draftDefinition: projection.draftDefinition } : {}),
          };
        }),
      );
      const last = page.at(-1);
      return jsonResult({
        templates,
        nextCursor:
          rows.length > input.limit && last
            ? cursorCodec.encode({
                orgId: input.orgId,
                actorId: actor.actorId,
                targetType: input.targetType ?? null,
                teamId: input.teamId ?? null,
                after: last.id,
              })
            : null,
      });
    }),
  );
}
