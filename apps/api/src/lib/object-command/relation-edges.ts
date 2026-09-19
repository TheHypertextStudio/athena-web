/** Edge reads and writes shared by the forward and replay relation handlers. */
import {
  initiativeProject,
  projectDependency,
  projectLabel,
  taskDependency,
  taskLabel,
} from '@docket/db';
import { and, eq, inArray, or } from 'drizzle-orm';

import type { Tx } from './types';

/** One association or dependency edge, named from the owning object outward. */
export interface RelationEdge {
  readonly objectId: string;
  readonly relatedId: string;
}

/** Every Label currently attached to the given Tasks or Projects. */
export async function loadAttachedLabels(
  tx: Tx,
  orgId: string,
  objectKind: 'task' | 'project',
  objectIds: readonly string[],
): Promise<RelationEdge[]> {
  return objectKind === 'task'
    ? tx
        .select({ objectId: taskLabel.taskId, relatedId: taskLabel.labelId })
        .from(taskLabel)
        .where(
          and(
            eq(taskLabel.organizationId, orgId),
            inArray(taskLabel.taskId, objectIds as string[]),
          ),
        )
    : tx
        .select({ objectId: projectLabel.projectId, relatedId: projectLabel.labelId })
        .from(projectLabel)
        .where(
          and(
            eq(projectLabel.organizationId, orgId),
            inArray(projectLabel.projectId, objectIds as string[]),
          ),
        );
}

/** Attach Labels, skipping edges that already exist, and report the edges actually written. */
export async function insertLabelEdges(
  tx: Tx,
  orgId: string,
  objectKind: 'task' | 'project',
  edges: readonly RelationEdge[],
): Promise<RelationEdge[]> {
  return objectKind === 'task'
    ? tx
        .insert(taskLabel)
        .values(
          edges.map((edge) => ({
            organizationId: orgId,
            taskId: edge.objectId,
            labelId: edge.relatedId,
          })),
        )
        .onConflictDoNothing()
        .returning({ objectId: taskLabel.taskId, relatedId: taskLabel.labelId })
    : tx
        .insert(projectLabel)
        .values(
          edges.map((edge) => ({
            organizationId: orgId,
            projectId: edge.objectId,
            labelId: edge.relatedId,
          })),
        )
        .onConflictDoNothing()
        .returning({ objectId: projectLabel.projectId, relatedId: projectLabel.labelId });
}

/** Detach Labels and report the edges actually removed. */
export async function deleteLabelEdges(
  tx: Tx,
  orgId: string,
  objectKind: 'task' | 'project',
  edges: readonly RelationEdge[],
): Promise<RelationEdge[]> {
  return objectKind === 'task'
    ? tx
        .delete(taskLabel)
        .where(
          and(
            eq(taskLabel.organizationId, orgId),
            or(
              ...edges.map((edge) =>
                and(eq(taskLabel.taskId, edge.objectId), eq(taskLabel.labelId, edge.relatedId)),
              ),
            ),
          ),
        )
        .returning({ objectId: taskLabel.taskId, relatedId: taskLabel.labelId })
    : tx
        .delete(projectLabel)
        .where(
          and(
            eq(projectLabel.organizationId, orgId),
            or(
              ...edges.map((edge) =>
                and(
                  eq(projectLabel.projectId, edge.objectId),
                  eq(projectLabel.labelId, edge.relatedId),
                ),
              ),
            ),
          ),
        )
        .returning({ objectId: projectLabel.projectId, relatedId: projectLabel.labelId });
}

/** Contribute Projects to Initiatives and report the edges actually written. */
export async function insertInitiativeEdges(
  tx: Tx,
  orgId: string,
  edges: readonly RelationEdge[],
): Promise<RelationEdge[]> {
  return tx
    .insert(initiativeProject)
    .values(
      edges.map((edge) => ({
        organizationId: orgId,
        projectId: edge.objectId,
        initiativeId: edge.relatedId,
      })),
    )
    .onConflictDoNothing()
    .returning({
      objectId: initiativeProject.projectId,
      relatedId: initiativeProject.initiativeId,
    });
}

/** Withdraw Projects from Initiatives and report the edges actually removed. */
export async function deleteInitiativeEdges(
  tx: Tx,
  orgId: string,
  edges: readonly RelationEdge[],
): Promise<RelationEdge[]> {
  return tx
    .delete(initiativeProject)
    .where(
      and(
        eq(initiativeProject.organizationId, orgId),
        or(
          ...edges.map((edge) =>
            and(
              eq(initiativeProject.projectId, edge.objectId),
              eq(initiativeProject.initiativeId, edge.relatedId),
            ),
          ),
        ),
      ),
    )
    .returning({
      objectId: initiativeProject.projectId,
      relatedId: initiativeProject.initiativeId,
    });
}

/** Create blocking edges, skipping ones that already exist, and report what was written. */
export async function insertDependencyEdges(
  tx: Tx,
  orgId: string,
  objectKind: 'task' | 'project',
  edges: readonly RelationEdge[],
): Promise<RelationEdge[]> {
  return objectKind === 'task'
    ? tx
        .insert(taskDependency)
        .values(
          edges.map((edge) => ({
            organizationId: orgId,
            blockingTaskId: edge.objectId,
            blockedTaskId: edge.relatedId,
          })),
        )
        .onConflictDoNothing()
        .returning({
          objectId: taskDependency.blockingTaskId,
          relatedId: taskDependency.blockedTaskId,
        })
    : tx
        .insert(projectDependency)
        .values(
          edges.map((edge) => ({
            organizationId: orgId,
            blockingProjectId: edge.objectId,
            blockedProjectId: edge.relatedId,
          })),
        )
        .onConflictDoNothing()
        .returning({
          objectId: projectDependency.blockingProjectId,
          relatedId: projectDependency.blockedProjectId,
        });
}

/** Drop blocking edges and report the edges actually removed. */
export async function deleteDependencyEdges(
  tx: Tx,
  orgId: string,
  objectKind: 'task' | 'project',
  edges: readonly RelationEdge[],
): Promise<RelationEdge[]> {
  return objectKind === 'task'
    ? tx
        .delete(taskDependency)
        .where(
          and(
            eq(taskDependency.organizationId, orgId),
            or(
              ...edges.map((edge) =>
                and(
                  eq(taskDependency.blockingTaskId, edge.objectId),
                  eq(taskDependency.blockedTaskId, edge.relatedId),
                ),
              ),
            ),
          ),
        )
        .returning({
          objectId: taskDependency.blockingTaskId,
          relatedId: taskDependency.blockedTaskId,
        })
    : tx
        .delete(projectDependency)
        .where(
          and(
            eq(projectDependency.organizationId, orgId),
            or(
              ...edges.map((edge) =>
                and(
                  eq(projectDependency.blockingProjectId, edge.objectId),
                  eq(projectDependency.blockedProjectId, edge.relatedId),
                ),
              ),
            ),
          ),
        )
        .returning({
          objectId: projectDependency.blockingProjectId,
          relatedId: projectDependency.blockedProjectId,
        });
}
