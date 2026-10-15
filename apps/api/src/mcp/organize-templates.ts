/** Populate organize items from visible work templates before opening the placement transaction. */
import { LabelId } from '@docket/work/ids';
import { TemplateDraft, TemplateTargetType } from '@docket/work/template-contract';
import { NotFoundError, ValidationError } from '../error';
import { prepareWorkTemplateCreation } from '../lib/work-template-creation';
import { OrganizeItem, resolveItem, type ItemRefs } from '../lib/organize/place';
import { labelTeamForItem } from '../lib/organize/item';
import { resolveStateTransition } from './tools-shared';
import { requireTemplateDecisions } from './template-selection';
import type { LandingTarget } from '../lib/task-landing';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { resolveAttachedLabels, resolveLabelSet } from '../lib/labels';
import { resolveVisibleTemplate } from './template-application';

/** Preserve explicit values, including empty strings and arrays, above template defaults. */
export async function populateOrganizeItem(
  orgId: string,
  actorId: string,
  item: OrganizeItem,
  teamId: string,
): Promise<{ item: OrganizeItem; templateId?: string }> {
  if (item.template === undefined && item.workTypeId === undefined) {
    const labels = await resolveLabelSet(orgId, item.labelIds, {
      teamId: labelTeamForItem(item.kind, teamId),
    });
    return { item: { ...item, labelIds: labels.map((label) => LabelId.parse(label.id)) } };
  }
  const row = await resolveVisibleTemplate(
    orgId,
    actorId,
    item.template ?? item.workTypeId ?? '',
    TemplateTargetType.parse(item.kind),
  );
  if (row.publicationState === 'published')
    return populatePublishedItem(orgId, item, teamId, row.id);
  if (item.workTypeId || item.workTypeVersionId) throw new NotFoundError('Template not found');
  return populateLegacyItem(orgId, item, teamId, row);
}

/** Apply a readable unpublished draft without assigning a published identity. */
async function populateLegacyItem(
  orgId: string,
  item: OrganizeItem,
  teamId: string,
  row: Awaited<ReturnType<typeof resolveVisibleTemplate>>,
): Promise<{ item: OrganizeItem; templateId: string }> {
  const draft = TemplateDraft.parse(row.payload);
  if (draft.targetType !== item.kind || (row.scope === 'team' && row.teamId !== teamId)) {
    throw new ValidationError([
      {
        path: [item.ref, 'template'],
        message: 'Choose a template for this kind and destination team.',
      },
    ]);
  }
  const explicit = Object.fromEntries(
    Object.entries(item).filter(([, value]) => value !== undefined),
  );
  const populated = OrganizeItem.parse({ ...draft, ...explicit });
  const labelIds = item.labelIds ?? (draft.targetType === 'task' ? draft.labelIds : undefined);
  const present = new Set(
    (await resolveAttachedLabels(orgId, labelIds ?? [])).map((label) => label.id),
  );
  const surviving =
    item.labelIds === undefined ? labelIds?.filter((id) => present.has(id)) : labelIds;
  const labels = await resolveLabelSet(orgId, surviving, {
    teamId: labelTeamForItem(item.kind, teamId),
  });
  return {
    item: { ...populated, labelIds: labels.map((label) => LabelId.parse(label.id)) },
    templateId: row.id,
  };
}

/** Apply and validate a published snapshot before resolving its destination labels. */
async function populatePublishedItem(
  orgId: string,
  item: OrganizeItem,
  teamId: string,
  workTypeId: string,
): Promise<{ item: OrganizeItem; templateId: string }> {
  const defaults = await prepareWorkTemplateCreation(orgId, TemplateTargetType.parse(item.kind), {
    ...item,
    teamId,
    workTypeId,
    workTypeVersionId: item.workTypeVersionId,
  });
  const populated = OrganizeItem.parse({ ...defaults, labelIds: item.labelIds ?? defaults.labels });
  const labels = await resolveLabelSet(orgId, populated.labelIds, {
    teamId: labelTeamForItem(item.kind, teamId),
  });
  return {
    item: { ...populated, labelIds: labels.map((label) => LabelId.parse(label.id)) },
    templateId: workTypeId,
  };
}

/** A resolved item ready for the placement transaction. */
export interface PreparedOrganizeItem {
  readonly item: OrganizeItem;
  readonly refs: ItemRefs;
  readonly state: Awaited<ReturnType<typeof resolveStateTransition>>;
  readonly templateId?: string | undefined;
}

/** Resolve template decisions, references, and explicit workflow states before any placement. */
export async function prepareOrganizeItems(
  orgId: string,
  actorId: string,
  ordered: readonly OrganizeItem[],
  { landing, scopes }: { landing: LandingTarget; scopes: readonly string[] },
): Promise<PreparedOrganizeItem[] | CallToolResult> {
  const preparedRefs = await Promise.all(
    ordered.map(async (item, index) => ({ item, index, refs: await resolveItem(orgId, item) })),
  );
  const selection = await requireTemplateDecisions(
    orgId,
    actorId,
    preparedRefs.map(({ item, refs }) => ({ ...item, teamId: refs.teamId ?? landing.teamId })),
    scopes,
  );
  if (selection) return selection;
  return Promise.all(
    preparedRefs.map(async ({ item: supplied, refs, index }) => {
      const populated = await populateOrganizeItem(
        orgId,
        actorId,
        supplied,
        refs.teamId ?? landing.teamId,
      );
      const { item } = populated;
      const state =
        item.state === undefined
          ? {
              statusId: landing.statusId,
              state: landing.state,
              completedAt: null,
              canceledAt: null,
            }
          : await resolveStateTransition(
              orgId,
              refs.teamId ?? landing.teamId,
              item.state,
              `items.${index}.state`,
            );
      return { item, refs, state, templateId: populated.templateId };
    }),
  );
}
