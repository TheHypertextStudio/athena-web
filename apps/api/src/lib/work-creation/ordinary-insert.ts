import { initiativeProject, initiativeProgram, taskRelatedTask } from '@docket/db';
import { trackedFields, type RecordedChange } from '../../mcp/change-set';
import { labelSetChange } from '../../mcp/change-set-labels';
import { relatedTaskLink } from '../provenance/task-change-sets';
import { relatedTaskPair } from '../../routes/task-related-replace';
import { replaceLabels } from '../labels';
import { insertMilestones, insertPreparedMilestoneRows } from '../milestone-writes';
import type { TemplateTransaction } from '../templates/persistence';
import { insertWorkRow, type InsertedWork } from './writers';
import type { OrdinaryWorkMutation, PreparedOrdinaryWork } from './types';

function createdChange(work: InsertedWork): RecordedChange {
  return { kind: work.kind, id: work.id, op: 'create', after: trackedFields(work.kind, work.row) };
}

async function ordinaryAssociations(
  tx: TemplateTransaction,
  prepared: PreparedOrdinaryWork,
  root: InsertedWork,
): Promise<RecordedChange[]> {
  const orgId = prepared.command.caller.orgId;
  const changes: RecordedChange[] = [];
  if (root.kind !== 'milestone' && prepared.labels.length) {
    await replaceLabels(tx, root.kind, root.id, orgId, prepared.labels);
    if (root.kind === 'project') {
      changes.push(
        ...prepared.labels.map((label) => ({
          kind: 'project_has_label' as const,
          from: root.id,
          to: label.id,
          linked: true,
        })),
      );
    } else if (root.kind === 'task') {
      const change = labelSetChange(
        'task',
        root.id,
        [],
        prepared.labels.map((label) => label.id),
      );
      changes.push(change);
    }
  }
  if (root.kind === 'task' && prepared.relatedTaskIds.length) {
    await tx.insert(taskRelatedTask).values(
      prepared.relatedTaskIds.map((id) => ({
        organizationId: orgId,
        ...relatedTaskPair(root.id, id),
      })),
    );
    changes.push(...prepared.relatedTaskIds.map((id) => relatedTaskLink(root.id, id, true)));
  }
  changes.push(...(await initiativeAssociations(tx, prepared, root)));
  return changes;
}

/** Insert prepared ordinary rows and links, without settlement, expansion, receipt or side effects. */
export async function insertPreparedOrdinaryWork(
  tx: TemplateTransaction,
  prepared: PreparedOrdinaryWork,
): Promise<OrdinaryWorkMutation> {
  const root = await insertWorkRow(tx, prepared.insert);
  const changes = [createdChange(root), ...(await ordinaryAssociations(tx, prepared, root))];
  const milestones = await insertExplicitCheckpoints(tx, prepared, root);
  const created: InsertedWork[] = [
    root,
    ...milestones.map((row) => ({ kind: 'milestone' as const, id: row.id, row })),
  ];
  changes.push(...created.slice(1).map(createdChange));
  return {
    root,
    created,
    changes,
    parentTaskIds: root.kind === 'task' ? [root.row.parentTaskId] : [],
    effects: created.flatMap((work) => [
      ...(work.kind === 'milestone'
        ? []
        : [
            {
              kind: 'created' as const,
              dedupeKey: `created:${work.kind}:${work.id}`,
              work,
              actorId: prepared.command.caller.actorId,
            },
          ]),
      { kind: 'search' as const, dedupeKey: `search:${work.kind}:${work.id}`, work },
    ]),
  };
}

async function insertExplicitCheckpoints(
  tx: TemplateTransaction,
  prepared: PreparedOrdinaryWork,
  root: InsertedWork,
) {
  if (root.kind !== 'project') return [];
  if (prepared.milestoneRows) return insertPreparedMilestoneRows(tx, prepared.milestoneRows);
  return insertMilestones(
    tx,
    {
      orgId: root.row.organizationId,
      projectId: root.id,
      actorId: prepared.command.caller.actorId,
    },
    prepared.milestones,
    0,
  );
}

async function initiativeAssociations(
  tx: TemplateTransaction,
  prepared: PreparedOrdinaryWork,
  root: InsertedWork,
): Promise<RecordedChange[]> {
  const orgId = prepared.command.caller.orgId;
  const changes: RecordedChange[] = [];
  if (root.kind === 'project' && prepared.initiativeIds.length) {
    await tx.insert(initiativeProject).values(
      prepared.initiativeIds.map((id) => ({
        organizationId: orgId,
        projectId: root.id,
        initiativeId: id,
      })),
    );
    changes.push(
      ...prepared.initiativeIds.map((id) => ({
        kind: 'project_contributes_to' as const,
        from: root.id,
        to: id,
        linked: true,
      })),
    );
  }
  if (root.kind === 'program' && prepared.initiativeIds.length) {
    await tx.insert(initiativeProgram).values(
      prepared.initiativeIds.map((id) => ({
        organizationId: orgId,
        programId: root.id,
        initiativeId: id,
      })),
    );
    changes.push(
      ...prepared.initiativeIds.map((id) => ({
        kind: 'program_contributes_to' as const,
        from: root.id,
        to: id,
        linked: true,
      })),
    );
  }
  return changes;
}
