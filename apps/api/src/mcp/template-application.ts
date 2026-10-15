/** Shared template resolution and task-default application for MCP authoring. */
import { db, template } from '@docket/db';
import { TaskCreate } from '@docket/work/task-model';
import { TemplateDraft, type TemplateTargetType } from '@docket/work/template-contract';

import { NotFoundError, ValidationError } from '../error';
import { getWorkTemplate } from '../lib/templates/service';
import { prepareWorkTemplateCreation } from '../lib/work-template-creation';
import { resolveAttachedLabels, resolveLabelSet } from '../lib/labels';
import { visibleTemplateWhere } from '../lib/templates/visibility';
import { type TemplateRow } from '../lib/templates/write';
import { isUlid, pick } from './descriptors';

/** Resolve a template by id or name within the caller's authorized set. */
export async function resolveVisibleTemplate(
  orgId: string,
  actorId: string,
  value: string,
  targetType?: TemplateTargetType,
): Promise<TemplateRow> {
  if (isUlid(value)) {
    const row = await getWorkTemplate({ orgId, actorId }, value);
    if (row.publicationState === 'archived') throw new NotFoundError('Template not found');
    return row;
  }
  const rows = await db
    .select({ id: template.id, label: template.name })
    .from(template)
    .where(visibleTemplateWhere(orgId, actorId, { targetType, includeBase: true }));
  return resolveVisibleTemplate(orgId, actorId, await pick('template', value, rows), targetType);
}

/**
 * Apply a visible task draft while preserving explicit properties and authored Markdown.
 * @throws {ValidationError} When the template targets another kind or team.
 */
export async function taskFromTemplate(
  orgId: string,
  actorId: string,
  value: string,
  task: TaskCreate,
  selection: { workTypeVersionId?: string | undefined; publishedOnly?: boolean } = {},
): Promise<TaskCreate> {
  const row = await resolveVisibleTemplate(orgId, actorId, value, 'task');
  if (row.publicationState === 'published') {
    return TaskCreate.parse(
      await prepareWorkTemplateCreation(orgId, 'task', {
        ...task,
        workTypeId: row.id,
        workTypeVersionId: selection.workTypeVersionId,
      }),
    );
  }
  if (selection.publishedOnly || selection.workTypeVersionId)
    throw new NotFoundError('Template not found');
  const draft = TemplateDraft.parse(row.payload);
  if (draft.targetType !== 'task' || (row.scope === 'team' && row.teamId !== task.teamId)) {
    throw new ValidationError([
      { path: ['template'], message: 'Choose a task template for the destination team.' },
    ]);
  }
  const defaults = await taskTemplateLabels(orgId, draft.labelIds, task);
  return TaskCreate.parse({
    ...task,
    description: task.description ?? draft.description,
    priority: task.priority ?? draft.priority,
    labels: task.labels ?? defaults.map((label) => label.id),
  });
}

/** Drop removed inherited labels while retaining strict explicit task overrides. */
async function taskTemplateLabels(
  orgId: string,
  labelIds: readonly string[] | undefined,
  task: TaskCreate,
) {
  if (task.labels !== undefined) return [];
  const attached = await resolveAttachedLabels(orgId, labelIds ?? []);
  const present = new Set(attached.map((label) => label.id));
  return resolveLabelSet(
    orgId,
    labelIds?.filter((id) => present.has(id)),
    { teamId: task.teamId },
  );
}
