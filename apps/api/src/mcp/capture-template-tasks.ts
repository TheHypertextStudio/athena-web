/** Create captured tasks with template defaults in the same transaction as their labels. */
import { task } from '@docket/db';
import { populateOrganizeItem } from './organize-templates';
import { TaskCreate } from '@docket/work/task-model';
import { OrganizeItem } from '../lib/organize/place';
import { deriveCaptureTitle } from '../lib/capture-title';
import { replaceLabels, resolveLabelSet } from '../lib/labels';
import { serializableTx } from '../lib/serializable-tx';
import type { LandingTarget } from '../lib/task-landing';

/** One capture's shared template choice and explicit default overrides. */
export interface CaptureDefaults {
  readonly template?: string | undefined;
  readonly withoutTemplateReason?: string | undefined;
  readonly description?: string | undefined;
  readonly priority?: string | undefined;
  readonly labelIds?: string[] | undefined;
}

/**
 * Capture titles or completed Markdown, preserving explicit bodies over saved defaults.
 * @returns Newly saved tasks, including their literal Markdown bodies.
 */
export async function createCapturedTasks(
  orgId: string,
  actorId: string,
  texts: readonly string[],
  landing: LandingTarget,
  defaults: CaptureDefaults,
): Promise<(typeof task.$inferSelect)[]> {
  const prepared = await Promise.all(
    texts.map(async (text, index) => {
      // A selected template turns one-line text into a title; multiline text remains authored body.
      const description =
        defaults.description ??
        (defaults.template !== undefined && !text.includes('\n') ? undefined : text);
      const populated = await populateOrganizeItem(
        orgId,
        actorId,
        OrganizeItem.parse({
          ...defaults,
          ref: String(index),
          kind: 'task',
          title: deriveCaptureTitle(text),
          description,
        }),
        landing.teamId,
      );
      const draft = TaskCreate.parse({
        title: populated.item.title,
        description: populated.item.description,
        teamId: landing.teamId,
        priority: populated.item.priority,
      });
      const labels = await resolveLabelSet(orgId, populated.item.labelIds, {
        teamId: landing.teamId,
      });
      return { draft, labels, templateId: populated.templateId };
    }),
  );
  return serializableTx(async (tx) => {
    const rows = await tx
      .insert(task)
      .values(
        prepared.map(({ draft, templateId }) => ({
          organizationId: orgId,
          title: draft.title,
          description: draft.description,
          priority: draft.priority,
          templateId,
          teamId: landing.teamId,
          statusId: landing.statusId,
          state: landing.state,
          assigneeId: landing.assigneeId,
          cycleId: landing.cycleId,
          source: 'native' as const,
          createdBy: actorId,
        })),
      )
      .returning();
    for (const [index, row] of rows.entries()) {
      const labels = prepared[index]?.labels ?? [];
      if (labels.length > 0) await replaceLabels(tx, 'task', row.id, orgId, labels);
    }
    return rows;
  });
}
