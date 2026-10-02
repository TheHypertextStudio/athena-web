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
import { requireScope } from './scope';

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
 * @throws {InsufficientScopeError} When applying or listing saved drafts without read scope.
 */
export async function requireTemplateDecisions(
  orgId: string,
  actorId: string,
  items: readonly TemplateDecision[],
  scopes: readonly string[],
): Promise<CallToolResult | null> {
  const choices = [];
  const catalogs = new Map<string, ReturnType<typeof readCatalog>>();
  const templates = new Map<string, ReturnType<typeof toTemplateOut>>();
  for (const item of items) {
    if (item.template !== undefined && item.withoutTemplateReason !== undefined) {
      throw new ValidationError([
        {
          path: [item.ref, 'template'],
          message: 'Select a template or explain a freeform choice, not both.',
        },
      ]);
    }
    if (item.template !== undefined) requireScope(scopes, 'work:read');
    const kind = TemplateTargetType.safeParse(item.kind);
    if (!kind.success || item.template !== undefined || item.withoutTemplateReason !== undefined)
      continue;
    const key = `${kind.data}:${item.teamId}`;
    let catalog = catalogs.get(key);
    if (!catalog) {
      catalog = readCatalog(
        { orgId, actorId, targetType: kind.data, teamId: item.teamId },
        templates,
      );
      catalogs.set(key, catalog);
    }
    const resolved = await catalog;
    if (!resolved) continue;
    choices.push({
      ref: item.ref,
      targetType: kind.data,
      catalogId: resolved.id,
    });
  }
  if (choices.length === 0) return null;
  requireScope(scopes, 'work:read');
  return {
    ...jsonResult({
      code: 'template_selection_required',
      message:
        'No work was created. Each choice references a catalogId; catalogs list templateIds from the shared templates array. Choose a relevant template and retry, or provide withoutTemplateReason. Read payload.description and retain its structure when filling the returned body. Call list_templates for the full catalog.',
      choices,
      catalogs: (await Promise.all(catalogs.values())).filter((catalog) => catalog !== null),
      templates: [...templates.values()],
    }),
    isError: true,
  };
}

/** Share catalog entries and literal bodies instead of repeating them for every unresolved item. */
async function readCatalog(
  context: { orgId: string; actorId: string; targetType: TemplateTargetType; teamId: string },
  templates: Map<string, ReturnType<typeof toTemplateOut>>,
) {
  const { orgId, actorId, targetType, teamId } = context;
  const rows = await eligibleTemplates(orgId, actorId, targetType, teamId);
  if (rows.length === 0) return null;
  const page = rows.slice(0, 20);
  for (const row of page) templates.set(row.id, toTemplateOut(row));
  return {
    id: `${targetType}:${teamId}`,
    targetType,
    teamId,
    templateIds: page.map((row) => row.id),
    hasMore: rows.length > 20,
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
