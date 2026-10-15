/** Recheck template references at the shared confirmation boundary. */
import { TemplateDraft } from '@docket/work/template-contract';
import type { LabelId } from '@docket/work/ids';
import { ValidationError } from '../../error';
import { resolveAttachedLabels } from '../labels';
import type { OrganizeItem } from '../organize/item';
import { resolveVisibleTemplate } from '../../mcp/template-application';
import { populateOrganizeItem } from '../../mcp/organize-templates';

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
  const saved = await resolveVisibleTemplate(orgId, actorId, item.template);
  const draft = TemplateDraft.parse(saved.payload);
  if (draft.targetType !== item.kind || (saved.scope === 'team' && saved.teamId !== teamId)) {
    throw new ValidationError([
      {
        path: [item.ref, 'templateId'],
        message: 'Choose a template for this kind and destination team.',
      },
    ]);
  }
  const prepared =
    saved.publicationState === 'published'
      ? (await populateOrganizeItem(orgId, actorId, item, teamId)).item
      : item;
  if (draft.targetType !== 'task') return prepared;
  if (inheritedLabelIds === undefined) return prepared;
  const defaults = inheritedLabelIds;
  const surviving = new Set(
    (await resolveAttachedLabels(orgId, defaults)).map((label) => label.id),
  );
  return { ...prepared, labelIds: defaults.filter((id) => surviving.has(id)) };
}
