/** Permission-filtered template discovery for clients that expose only MCP tools. */
import { db, template } from '@docket/db';
import { TemplateOut, TemplateTargetType } from '@docket/work/template-contract';
import { and, asc, gt } from 'drizzle-orm';
import { z } from 'zod';

import { ValidationError } from '../error';
import { seedDefaultTemplates } from '../lib/templates/defaults';
import { visibleTemplateWhere } from '../lib/templates/visibility';
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
    'Discover literal Markdown template bodies before writing tasks, projects, initiatives, or programs. Generally use a fitting template: read payload.description, preserve its structure, and fill its sections with work-specific content. The template description is only a usage summary. Returns only workspace templates, your personal templates, and templates for teams you belong to, with their full payloads. Use an id with plan_draft apply_template or repeat_task template. Use define_template to author or edit a draft. No matching template is required for quick capture or explicitly freeform work.',
  inputSchema: {
    orgId: orgIdParam,
    targetType: TemplateTargetType.optional().describe(
      'Only templates for this kind of work. Match it to the plan node kind; repeat_task requires task.',
    ),
    limit: z.number().int().min(1).max(100).default(50),
    cursor: z
      .string()
      .optional()
      .describe('The nextCursor from the preceding page. Keep orgId and targetType unchanged.'),
  },
  outputSchema: {
    templates: z
      .array(TemplateOut)
      .describe('Visible drafts. A team-scoped draft applies only to work on its teamId.'),
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
      if (
        cursor &&
        (cursor.orgId !== input.orgId ||
          cursor.actorId !== actor.actorId ||
          cursor.targetType !== (input.targetType ?? null))
      ) {
        throw new ValidationError([
          {
            path: ['cursor'],
            message: 'The template cursor belongs to another caller, workspace, or filter.',
          },
        ]);
      }
      await seedDefaultTemplates(input.orgId, actor.actorId);
      const rows = await db
        .select()
        .from(template)
        .where(
          and(
            visibleTemplateWhere(input.orgId, actor.actorId, { targetType: input.targetType }),
            cursor ? gt(template.id, cursor.after) : undefined,
          ),
        )
        .orderBy(asc(template.id))
        .limit(input.limit + 1);
      const page = rows.slice(0, input.limit);
      const last = page.at(-1);
      return jsonResult({
        templates: page.map(toTemplateOut),
        nextCursor:
          rows.length > input.limit && last
            ? cursorCodec.encode({
                orgId: input.orgId,
                actorId: actor.actorId,
                targetType: input.targetType ?? null,
                after: last.id,
              })
            : null,
      });
    }),
  );
}
