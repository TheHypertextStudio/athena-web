/** Keep MCP plan confirmation from bypassing direct creation's template decisions. */
import { planNodeClosure } from '@docket/work/plan-draft';
import { TemplateDraft } from '@docket/work/template-contract';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { NotFoundError, ValidationError } from '../error';
import type { PlanDraftRow } from '../lib/plan-draft/store';
import { resolveLandingTarget } from '../lib/task-landing';
import { requireTemplateDecisions } from './template-selection';
import { resolveVisibleTemplate } from './template-application';
import { jsonResult } from './result';
import { requireScope } from './scope';

/** Validate the template choice for every node confirmation will create, including ancestors. */
export async function requirePlanTemplateDecisions(
  row: PlanDraftRow,
  { actorId, scopes }: { actorId: string; scopes: readonly string[] },
  refs: readonly string[],
  withoutTemplateReason: string | undefined,
): Promise<CallToolResult | null> {
  const closure = new Set(planNodeClosure(row.document, refs));
  const nodes = row.document.nodes.filter((node) => closure.has(node.ref));
  if (nodes.length === 0) return null;
  const landing = await resolveLandingTarget(row.organizationId, actorId);
  if (!landing) throw new NotFoundError();
  const selection = await requireTemplateDecisions(
    row.organizationId,
    actorId,
    nodes.map((node) => ({
      ref: node.ref,
      kind: node.kind,
      teamId: node.fields.teamId ?? landing.teamId,
      template: node.templateId ?? undefined,
      withoutTemplateReason: node.templateId === null ? withoutTemplateReason : undefined,
    })),
    scopes,
  );
  if (selection) return selection;
  for (const node of nodes) {
    if (node.templateId === null) continue;
    const saved = await resolveVisibleTemplate(row.organizationId, actorId, node.templateId);
    const draft = TemplateDraft.parse(saved.payload);
    if (
      draft.targetType !== node.kind ||
      (saved.scope === 'team' && saved.teamId !== (node.fields.teamId ?? landing.teamId))
    ) {
      throw new ValidationError([
        {
          path: [node.ref, 'templateId'],
          message: 'Choose a template for this node kind and team.',
        },
      ]);
    }
    if (node.fields.description === undefined && draft.description !== undefined) {
      requireScope(scopes, 'work:read');
      return {
        ...jsonResult({
          code: 'template_application_required',
          ref: node.ref,
          templateId: saved.id,
          body: draft.description,
          message:
            'No work was created. Apply this template through plan_draft apply_template and fill its sections. A templateId alone does not copy its body.',
        }),
        isError: true,
      };
    }
  }
  return null;
}
