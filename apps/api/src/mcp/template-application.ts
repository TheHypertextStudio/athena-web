/** Shared template resolution and task-default application for MCP authoring. */
import { db, template } from '@docket/db';
import { TaskCreate } from '@docket/work/task-model';
import { TemplateDraft } from '@docket/work/template-contract';

import { ValidationError } from '../error';
import { resolveAttachedLabels, resolveLabelSet } from '../lib/labels';
import { visibleTemplateWhere } from '../lib/templates/visibility';
import { requireVisibleTemplate, type TemplateRow } from '../lib/templates/write';
import { isUlid, pick } from './descriptors';

/** Resolve a template by id or name within the caller's authorized set. */
export async function resolveVisibleTemplate(
  orgId: string,
  actorId: string,
  value: string,
): Promise<TemplateRow> {
  if (isUlid(value)) return requireVisibleTemplate(orgId, actorId, value);
  const rows = await db
    .select({ id: template.id, label: template.name })
    .from(template)
    .where(visibleTemplateWhere(orgId, actorId, {}));
  return requireVisibleTemplate(orgId, actorId, await pick('template', value, rows));
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
): Promise<TaskCreate> {
  const row = await resolveVisibleTemplate(orgId, actorId, value);
  const draft = TemplateDraft.parse(row.payload);
  if (draft.targetType !== 'task' || (row.scope === 'team' && row.teamId !== task.teamId)) {
    throw new ValidationError([
      { path: ['template'], message: 'Choose a task template for the destination team.' },
    ]);
  }
  const attached = await resolveAttachedLabels(orgId, draft.labelIds ?? []);
  const present = new Set(attached.map((label) => label.id));
  const defaults =
    task.labels === undefined
      ? await resolveLabelSet(
          orgId,
          draft.labelIds?.filter((id) => present.has(id)),
          { teamId: task.teamId },
        )
      : [];
  return TaskCreate.parse({
    ...task,
    description: task.description ?? draft.description,
    priority: task.priority ?? draft.priority,
    labels: task.labels ?? defaults.map((label) => label.id),
  });
}
