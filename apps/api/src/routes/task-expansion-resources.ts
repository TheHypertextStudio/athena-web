import { db, attachment } from '@docket/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { loadEntityMentions } from '../content/entity-mentions';

/** Load only resources that are already direct or visibility-filtered context for one task. */
export async function loadTaskExpansionResources(
  orgId: string,
  actorId: string,
  taskId: string,
): Promise<readonly { title: string; url: string | null }[]> {
  const [attachments, mentions] = await Promise.all([
    db
      .select({ title: attachment.title, url: attachment.url })
      .from(attachment)
      .where(
        and(
          eq(attachment.organizationId, orgId),
          eq(attachment.subjectType, 'task'),
          eq(attachment.subjectId, taskId),
          isNull(attachment.archivedAt),
        ),
      )
      .orderBy(asc(attachment.createdAt)),
    loadEntityMentions({
      caller: { kind: 'agent', actorId, organizationId: orgId },
      orgId,
      subjectType: 'task',
      subjectId: taskId,
    }),
  ]);
  return [
    ...attachments,
    ...mentions.external.map((mention) => ({ title: mention.label, url: mention.href })),
    ...mentions.entities.map((mention) => ({ title: mention.label, url: null })),
  ];
}
