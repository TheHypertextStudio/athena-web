import {
  actor,
  attachment,
  db,
  inboundTaskRoute,
  label,
  organization,
  project,
  task,
  taskLabel,
  workStatus,
} from '@docket/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import type { ActiveWorkOut as ActiveWorkPayload } from '../contracts/active-work';
import { resourceAccessKey, resolveResourceAccess } from '../permissions/resource-access';
import { buildTaskViewFilter } from '../routes/task-helpers';

interface ActiveMembership {
  readonly actorId: string;
  readonly workspace: { id: string; name: string; slug: string };
}

interface ActiveWorkReference {
  readonly url: string;
  readonly title: string | null;
  readonly source: 'task_attachment' | 'task_description' | 'task_provenance' | 'project_resource';
}

type VisibleTask = NonNullable<Awaited<ReturnType<typeof visibleTask>>>;
type VisibleProject = NonNullable<Awaited<ReturnType<typeof visibleProject>>>;

/** Return active, non-archived human memberships for one authenticated person. */
async function activeMemberships(userId: string): Promise<ActiveMembership[]> {
  return db
    .select({ actorId: actor.id, workspace: organization })
    .from(actor)
    .innerJoin(organization, eq(organization.id, actor.organizationId))
    .where(
      and(
        eq(actor.userId, userId),
        eq(actor.kind, 'human'),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
        isNull(organization.archivedAt),
      ),
    );
}

/** Load the task and the membership that grants its initial workspace reachability. */
async function visibleTask(userId: string, taskId: string) {
  const memberships = await activeMemberships(userId);
  const membershipByWorkspace = new Map(
    memberships.map((membership) => [membership.workspace.id, membership]),
  );
  if (membershipByWorkspace.size === 0) return null;

  const [taskRow] = await db
    .select({
      id: task.id,
      organizationId: task.organizationId,
      title: task.title,
      description: task.description,
      statusId: task.statusId,
      stateType: workStatus.category,
      externalUrl: task.externalUrl,
      teamId: task.teamId,
      projectId: task.projectId,
      programId: task.programId,
      visibility: task.visibility,
    })
    .from(task)
    .innerJoin(workStatus, eq(workStatus.id, task.statusId))
    .where(
      and(
        eq(task.id, taskId),
        inArray(task.organizationId, [...membershipByWorkspace.keys()]),
        isNull(task.archivedAt),
      ),
    )
    .limit(1);
  const membership = taskRow ? membershipByWorkspace.get(taskRow.organizationId) : undefined;
  if (!taskRow || !membership) return null;

  const canViewTask = await buildTaskViewFilter(taskRow.organizationId, membership.actorId);
  return canViewTask(taskRow) ? { taskRow, membership } : null;
}

/** Load the anchored project only when the caller can view it independently. */
async function visibleProject(userId: string, taskContext: VisibleTask) {
  const { taskRow } = taskContext;
  if (!taskRow.projectId) return null;
  const [projectRow] = await db
    .select({
      id: project.id,
      name: project.name,
      summary: project.summary,
      organizationId: project.organizationId,
    })
    .from(project)
    .where(
      and(
        eq(project.id, taskRow.projectId),
        eq(project.organizationId, taskRow.organizationId),
        isNull(project.archivedAt),
      ),
    )
    .limit(1);
  if (!projectRow) return null;

  const access = await resolveResourceAccess(userId, [
    { organizationId: projectRow.organizationId, kind: 'project', id: projectRow.id },
  ]);
  return access.get(
    resourceAccessKey({
      organizationId: projectRow.organizationId,
      kind: 'project',
      id: projectRow.id,
    }),
  )?.canView === true
    ? projectRow
    : null;
}

/** Load every relation that contributes labels or destination references. */
async function taskRelations(taskContext: VisibleTask, projectContext: VisibleProject | null) {
  const { taskRow } = taskContext;
  return Promise.all([
    db
      .select({ id: label.id, name: label.name })
      .from(taskLabel)
      .innerJoin(label, eq(label.id, taskLabel.labelId))
      .where(
        and(eq(taskLabel.taskId, taskRow.id), eq(taskLabel.organizationId, taskRow.organizationId)),
      )
      .orderBy(asc(label.name)),
    db
      .select({ url: attachment.url, title: attachment.title })
      .from(attachment)
      .where(
        and(
          eq(attachment.organizationId, taskRow.organizationId),
          eq(attachment.subjectType, 'task'),
          eq(attachment.subjectId, taskRow.id),
          eq(attachment.kind, 'url'),
        ),
      )
      .orderBy(asc(attachment.createdAt)),
    db
      .select({ sourceUrl: inboundTaskRoute.sourceUrl })
      .from(inboundTaskRoute)
      .where(
        and(
          eq(inboundTaskRoute.organizationId, taskRow.organizationId),
          eq(inboundTaskRoute.taskId, taskRow.id),
        ),
      ),
    projectContext
      ? db
          .select({ url: attachment.url, title: attachment.title })
          .from(attachment)
          .where(
            and(
              eq(attachment.organizationId, taskRow.organizationId),
              eq(attachment.subjectType, 'project'),
              eq(attachment.subjectId, projectContext.id),
              eq(attachment.kind, 'url'),
            ),
          )
          .orderBy(asc(attachment.createdAt))
      : Promise.resolve([]),
  ]);
}

/** Return a normalized absolute HTTP(S) URL, or null for untrusted text. */
function webUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** Extract absolute HTTP(S) URLs from the stored task description. */
function descriptionUrls(description: string | null): string[] {
  const urls = new Set<string>();
  for (const match of description?.matchAll(/https?:\/\/[^\s)<>{}\]]+/g) ?? []) {
    const url = webUrl(match[0]);
    if (url) urls.add(url);
  }
  return [...urls];
}

/** Keep source context while removing repeated resource rows. */
function uniqueReferences(references: readonly ActiveWorkReference[]): ActiveWorkReference[] {
  const seen = new Set<string>();
  return references.filter((reference) => {
    const key = `${reference.source}:${reference.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Convert stored task links into the versioned active-work reference contract. */
function activeWorkReferences(
  taskContext: VisibleTask,
  taskAttachments: { url: string | null; title: string | null }[],
  provenance: { sourceUrl: string | null }[],
  projectResources: { url: string | null; title: string | null }[],
): ActiveWorkReference[] {
  const { taskRow } = taskContext;
  return uniqueReferences([
    ...taskAttachments.flatMap((reference) => {
      const url = webUrl(reference.url);
      return url ? [{ url, title: reference.title, source: 'task_attachment' as const }] : [];
    }),
    ...descriptionUrls(taskRow.description).map((url) => ({
      url,
      title: null,
      source: 'task_description' as const,
    })),
    ...[taskRow.externalUrl, ...provenance.map((reference) => reference.sourceUrl)].flatMap(
      (value) => {
        const url = webUrl(value);
        return url ? [{ url, title: null, source: 'task_provenance' as const }] : [];
      },
    ),
    ...projectResources.flatMap((reference) => {
      const url = webUrl(reference.url);
      return url ? [{ url, title: reference.title, source: 'project_resource' as const }] : [];
    }),
  ]);
}

/** Load task context only when the authenticated person can view every returned relation. */
export async function loadVisibleTaskContext(
  userId: string,
  taskId: string,
): Promise<ActiveWorkPayload['task']> {
  const taskContext = await visibleTask(userId, taskId);
  if (!taskContext) return null;
  const projectContext = await visibleProject(userId, taskContext);
  const [labels, taskAttachments, provenance, projectResources] = await taskRelations(
    taskContext,
    projectContext,
  );
  const { taskRow, membership } = taskContext;

  return {
    id: taskRow.id,
    organizationId: taskRow.organizationId,
    title: taskRow.title,
    description: taskRow.description,
    stateType: taskRow.stateType,
    workspace: { id: membership.workspace.id, name: membership.workspace.name },
    project: projectContext
      ? { id: projectContext.id, name: projectContext.name, summary: projectContext.summary }
      : null,
    labels,
    references: activeWorkReferences(taskContext, taskAttachments, provenance, projectResources),
  };
}
