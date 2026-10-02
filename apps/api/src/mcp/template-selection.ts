/** Explicit template decisions at the boundary of direct MCP creation. */
import { db, template } from '@docket/db';
import { TemplateTargetType } from '@docket/work/template-contract';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ValidationError } from '../error';
import { visibleTemplateWhere } from '../lib/templates/visibility';
import { toTemplateOut } from '../lib/templates/write';
import { jsonResult } from './result';

/** Creation callers either select a visible template or explain their freeform choice. */
export const templateDecisionFields = {
  template: z
    .string()
    .min(1)
    .optional()
    .describe(
      'A relevant visible template ID or exact name from list_templates. The server copies omitted Markdown and property defaults. Explicit fields override defaults; use update to fill the returned body.',
    ),
  withoutTemplateReason: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .optional()
    .describe(
      'Explain why no template fits, the user requested freeform content, or quick capture needs no outline. Required when eligible saved templates exist and template is omitted. Do not use together with template.',
    ),
};

/** One item whose creation must account for eligible templates. */
export interface TemplateDecision {
  readonly ref: string;
  readonly kind: string;
  readonly teamId: string;
  readonly template?: string | undefined;
  readonly withoutTemplateReason?: string | undefined;
}

/**
 * Refuse an undecided creation with visible choices before any work rows are written.
 * @returns An MCP execution error with full drafts, or null when every decision is resolved.
 * @throws {ValidationError} When a caller both selects and declines a template.
 */
export async function requireTemplateDecisions(
  orgId: string,
  actorId: string,
  items: readonly TemplateDecision[],
): Promise<CallToolResult | null> {
  const choices = [];
  const catalogs = new Map<string, ReturnType<typeof eligibleTemplates>>();
  for (const item of items) {
    if (item.template !== undefined && item.withoutTemplateReason !== undefined) {
      throw new ValidationError([
        {
          path: [item.ref, 'template'],
          message: 'Select a template or explain a freeform choice, not both.',
        },
      ]);
    }
    const kind = TemplateTargetType.safeParse(item.kind);
    if (!kind.success || item.template !== undefined || item.withoutTemplateReason !== undefined)
      continue;
    const key = `${kind.data}:${item.teamId}`;
    let catalog = catalogs.get(key);
    if (!catalog) {
      catalog = eligibleTemplates(orgId, actorId, kind.data, item.teamId);
      catalogs.set(key, catalog);
    }
    const templates = await catalog;
    if (templates.length === 0) continue;
    choices.push({
      ref: item.ref,
      targetType: kind.data,
      templates: templates.slice(0, 20).map(toTemplateOut),
      hasMore: templates.length > 20,
    });
  }
  if (choices.length === 0) return null;
  return {
    ...jsonResult({
      code: 'template_selection_required',
      message:
        'No work was created. Choose a relevant template for each listed item and retry, or provide withoutTemplateReason. Read payload.description and retain its structure when filling the returned body. Call list_templates for the full catalog.',
      choices,
    }),
    isError: true,
  };
}

/** Restrict suggestions to the requested kind and destination team without seeding new rows. */
async function eligibleTemplates(
  orgId: string,
  actorId: string,
  targetType: TemplateTargetType,
  teamId: string,
) {
  return db
    .select()
    .from(template)
    .where(
      and(
        visibleTemplateWhere(orgId, actorId, { targetType }),
        or(isNull(template.teamId), eq(template.teamId, teamId)),
      ),
    )
    .orderBy(asc(template.id))
    .limit(21);
}
