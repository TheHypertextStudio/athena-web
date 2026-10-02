/** Populate organize items from visible work templates before opening the placement transaction. */
import { LabelId } from '@docket/work/ids';
import { TemplateDraft, TemplateTargetType } from '@docket/work/template-contract';
import { ValidationError } from '../error';
import { OrganizeItem, resolveItem, type ItemRefs } from '../lib/organize/place';
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
  if (item.template === undefined) {
    const labels = await resolveLabelSet(orgId, item.labelIds, {
      teamId: item.kind === 'task' ? teamId : null,
    });
    return { item: { ...item, labelIds: labels.map((label) => LabelId.parse(label.id)) } };
  }
  const row = await resolveVisibleTemplate(
    orgId,
    actorId,
    item.template,
    TemplateTargetType.parse(item.kind),
  );
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
  const surviving =
    item.labelIds === undefined
      ? (await resolveAttachedLabels(orgId, labelIds ?? [])).map((label) => label.id)
      : labelIds;
  const labels = await resolveLabelSet(orgId, surviving, {
    teamId: item.kind === 'task' ? teamId : null,
  });
  return {
    item: { ...populated, labelIds: labels.map((label) => LabelId.parse(label.id)) },
    templateId: row.id,
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
  landing: LandingTarget,
): Promise<PreparedOrganizeItem[] | CallToolResult> {
  const preparedRefs = await Promise.all(
    ordered.map(async (item, index) => ({ item, index, refs: await resolveItem(orgId, item) })),
  );
  const selection = await requireTemplateDecisions(
    orgId,
    actorId,
    preparedRefs.map(({ item, refs }) => ({ ...item, teamId: refs.teamId ?? landing.teamId })),
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
