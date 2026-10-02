/** Recheck template references at the shared confirmation boundary. */
import { TemplateDraft } from '@docket/work/template-contract';
import type { LabelId } from '@docket/work/ids';
import { ValidationError } from '../../error';
import { resolveAttachedLabels } from '../labels';
import type { OrganizeItem } from '../organize/item';
import { requireVisibleTemplate } from '../templates/write';

/**
 * Validate attribution for both human and MCP confirmation without replacing authored fields.
 * Deleted inherited label defaults are dropped; explicit label overrides remain strict.
 * @throws {NotFoundError} When the selected template is unavailable to this actor.
 * @throws {ValidationError} When the template targets another kind or destination team.
 */
export async function preparePlanTemplate(
  { orgId, actorId }: { orgId: string; actorId: string },
  item: OrganizeItem,
  teamId: string,
  inheritedLabelIds: readonly LabelId[] | undefined,
): Promise<OrganizeItem> {
  if (item.template === undefined) return item;
  const saved = await requireVisibleTemplate(orgId, actorId, item.template);
  const draft = TemplateDraft.parse(saved.payload);
  if (draft.targetType !== item.kind || (saved.scope === 'team' && saved.teamId !== teamId)) {
    throw new ValidationError([
      {
        path: [item.ref, 'templateId'],
        message: 'Choose a template for this kind and destination team.',
      },
    ]);
  }
  if (draft.targetType !== 'task') return item;
  if (inheritedLabelIds === undefined) return item;
  const defaults = inheritedLabelIds;
  const surviving = new Set(
    (await resolveAttachedLabels(orgId, defaults)).map((label) => label.id),
  );
  return { ...item, labelIds: defaults.filter((id) => surviving.has(id)) };
}
