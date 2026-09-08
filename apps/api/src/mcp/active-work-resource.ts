/**
 * The Hub MCP resource that reports the caller's current Time Ledger record.
 */
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
  timeRecord,
} from '@docket/db';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { ActiveWorkOut, type ActiveWorkOut as ActiveWorkPayload } from '../contracts/active-work';
import { resourceAccessKey, resolveResourceAccess } from '../permissions/resource-access';
import { buildTaskViewFilter } from '../routes/task-helpers';
import type { McpContext } from './auth';
import type { McpRegistrar } from './catalog';
import { jsonRead } from './resource-statics';
import { RESOURCE_READ_SCOPE, requireScope } from './scope';

interface ActiveMembership {
  readonly actorId: string;
  readonly workspace: { id: string; name: string; slug: string };
}

interface ActiveWorkReference {
  readonly url: string;
  readonly title: string | null;
  readonly source: 'task_attachment' | 'task_description' | 'task_provenance' | 'project_resource';
}

/** Return active, non-archived human memberships for one authenticated person. */
async function activeMemberships(userId: string): Promise<ActiveMembership[]> {
  const rows = await db
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
  return rows;
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

interface CurrentRecord {
  readonly id: string;
  readonly title: string;
  readonly startedAt: Date | null;
  readonly status: string;
  readonly taskId: string | null;
}

/** Return the most relevant active record, prioritizing work that is still open. */
async function currentRecord(userId: string): Promise<CurrentRecord | null> {
  const [record] = await db
    .select({
      id: timeRecord.id,
      title: timeRecord.title,
      startedAt: timeRecord.startedAt,
      status: timeRecord.status,
      taskId: timeRecord.taskId,
    })
    .from(timeRecord)
    .where(
      and(eq(timeRecord.createdByUserId, userId), inArray(timeRecord.status, ['open', 'paused'])),
    )
    .orderBy(
      sql`case when ${timeRecord.status} = 'open' then 0 else 1 end`,
      desc(timeRecord.updatedAt),
      desc(timeRecord.id),
    )
    .limit(1);
  return record ?? null;
}

/** Convert a Time Ledger row into a response that has no task context. */
function recordPayload(
  record: CurrentRecord,
  title: string | null = record.title,
): ActiveWorkPayload {
  return {
    tracking: record.status === 'open' ? 'running' : 'paused',
    record: { id: record.id, title, startedAt: record.startedAt?.toISOString() ?? null },
    task: null,
  };
}

/** Resolve visible task context and omit it when the caller cannot view the anchored task. */
async function visibleTaskContext(
  userId: string,
  taskId: string,
): Promise<ActiveWorkPayload['task']> {
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
      externalUrl: task.externalUrl,
      teamId: task.teamId,
      projectId: task.projectId,
      programId: task.programId,
      visibility: task.visibility,
    })
    .from(task)
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
  if (!canViewTask(taskRow)) return null;

  const [projectRow] = taskRow.projectId
    ? await db
        .select({ id: project.id, name: project.name, organizationId: project.organizationId })
        .from(project)
        .where(
          and(
            eq(project.id, taskRow.projectId),
            eq(project.organizationId, taskRow.organizationId),
            isNull(project.archivedAt),
          ),
        )
        .limit(1)
    : [];
  const canViewProject = projectRow
    ? (
        await resolveResourceAccess(userId, [
          { organizationId: projectRow.organizationId, kind: 'project', id: projectRow.id },
        ])
      ).get(
        resourceAccessKey({
          organizationId: projectRow.organizationId,
          kind: 'project',
          id: projectRow.id,
        }),
      )?.canView === true
    : false;
  const visibleProject = canViewProject ? projectRow : null;

  const [labels, taskAttachments, provenance, projectResources] = await Promise.all([
    db
      .select({ id: label.id, name: label.name, color: label.color })
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
    visibleProject
      ? db
          .select({ url: attachment.url, title: attachment.title })
          .from(attachment)
          .where(
            and(
              eq(attachment.organizationId, taskRow.organizationId),
              eq(attachment.subjectType, 'project'),
              eq(attachment.subjectId, visibleProject.id),
              eq(attachment.kind, 'url'),
            ),
          )
          .orderBy(asc(attachment.createdAt))
      : Promise.resolve([]),
  ]);
  const references = uniqueReferences([
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

  return {
    id: taskRow.id,
    title: taskRow.title,
    workspace: membership.workspace,
    project: visibleProject ? { id: visibleProject.id, name: visibleProject.name } : null,
    labels,
    references,
  };
}

/** Read the caller's record without exposing its title until its anchored task is visible. */
async function readActiveWork(ctx: McpContext): Promise<ActiveWorkPayload> {
  requireScope(ctx.scopes, RESOURCE_READ_SCOPE);
  if (ctx.principal.kind !== 'user') {
    return { tracking: 'idle', record: null, task: null };
  }

  const record = await currentRecord(ctx.principal.userId);
  if (!record) return { tracking: 'idle', record: null, task: null };
  if (!record.taskId) return recordPayload(record);

  const task = await visibleTaskContext(ctx.principal.userId, record.taskId);
  return ActiveWorkOut.parse(
    task ? { ...recordPayload(record), task } : recordPayload(record, null),
  );
}

/** Register the authenticated static resource for the caller's current tracked work. */
export function registerActiveWorkResource(server: McpRegistrar, ctx: McpContext): void {
  server.registerResource(
    'hub-active-work',
    'docket://hub/active-work',
    {
      title: 'Hub - active work',
      description: "The caller's current Time Ledger record and visible task context.",
      mimeType: 'application/json',
    },
    async (uri): Promise<ReadResourceResult> =>
      jsonRead(uri, ActiveWorkOut.parse(await readActiveWork(ctx))),
  );
}
