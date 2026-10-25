/** Resolve only explicitly selected, currently authorized saved context. */
import {
  actor,
  agentSession,
  agentSessionTranscript,
  db,
  task,
  integration,
  type Database,
} from '@docket/db';
import type { z } from 'zod';
import {
  TemplateTailoringSelection,
  type TemplateTailoringSources,
} from '@docket/work/template-gallery-contract';
import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { NotFoundError, ValidationError } from '../error';
import { requireTemplateAuthor } from '../lib/templates/authorization';
import { assertProductCapability } from '../product-capability';
import { viewableResourceKeys, resourceAccessKey } from '../permissions/resource-access';

/** Request-authenticated human identity; actor is rechecked against its persisted owner. */
export interface TailoringCaller {
  readonly orgId: string;
  readonly actorId: string;
  readonly userId: string;
}
/** Authorized reusable context stripped of provider reasoning and tool results. */
export interface TailoringContext {
  readonly conversations: readonly { id: string; text: string }[];
  readonly importedWork: readonly {
    id: string;
    title: string;
    description: string | null;
    integrationId: string | null;
    externalId: string | null;
  }[];
}

/** Check identity before reading any selected source metadata or body. */
export async function requireTailoringCaller(
  caller: TailoringCaller,
  database: Database = db,
): Promise<void> {
  const [human] = await database
    .select({ id: actor.id })
    .from(actor)
    .where(
      and(
        eq(actor.id, caller.actorId),
        eq(actor.organizationId, caller.orgId),
        eq(actor.userId, caller.userId),
        eq(actor.kind, 'human'),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
      ),
    );
  if (!human) throw new NotFoundError();
}
/** Recheck commercial and live authoring gates without trusting cached capabilities. */
export async function requireTailoringAuthor(
  caller: TailoringCaller,
  database: Database = db,
): Promise<void> {
  await requireTailoringCaller(caller, database);
  await assertProductCapability(caller.orgId, 'athena', database);
  await requireTemplateAuthor({ orgId: caller.orgId, actorId: caller.actorId }, database);
}
/** Load authorized selected conversation text and imported work, never external connectors. */
export async function loadTailoringContext(
  caller: TailoringCaller,
  raw: TemplateTailoringSelection,
  database: Database = db,
): Promise<TailoringContext> {
  const input = TemplateTailoringSelection.parse({
    fork: raw.fork,
    sessionIds: raw.sessionIds,
    importedTaskIds: raw.importedTaskIds,
  });
  await requireTailoringAuthor(caller, database);
  const sessionIds = [...new Set(input.sessionIds)].sort(),
    taskIds = [...new Set(input.importedTaskIds)].sort();
  if (sessionIds.length + taskIds.length === 0)
    throw new ValidationError([{ path: [], message: 'Choose saved context.' }]);
  const conversations = await conversationText(caller, sessionIds, database);
  const importedWork = await importedText(caller, taskIds, database);
  const result = { conversations, importedWork };
  if (JSON.stringify(result).length > 100_000)
    throw new ValidationError([{ path: [], message: 'Choose less context.' }]);
  return result;
}
async function conversationText(
  caller: TailoringCaller,
  ids: readonly string[],
  database: Database,
) {
  if (!ids.length) return [];
  const sessions = await database
    .select({ id: agentSession.id })
    .from(agentSession)
    .where(
      and(
        inArray(agentSession.id, [...ids]),
        eq(agentSession.ownerUserId, caller.userId),
        eq(agentSession.executorKind, 'athena'),
        eq(agentSession.kind, 'chat'),
        eq(agentSession.contextOrganizationId, caller.orgId),
      ),
    )
    .for('share');
  if (sessions.length !== ids.length) throw new NotFoundError();
  const rows = await database
    .select()
    .from(agentSessionTranscript)
    .where(inArray(agentSessionTranscript.sessionId, [...ids]))
    .for('share');
  return ids.map((id) => {
    const row = rows.find((item) => item.sessionId === id);
    const text =
      row?.messages
        .flatMap((message) =>
          message.content.flatMap((block) =>
            block.type === 'text' ? [`${message.role}: ${block.text}`] : [],
          ),
        )
        .join('\n') ?? '';
    if (!text.trim())
      throw new ValidationError([
        { path: ['sessionIds'], message: 'This conversation has no saved text.' },
      ]);
    return { id, text };
  });
}
async function importedText(caller: TailoringCaller, ids: readonly string[], database: Database) {
  if (!ids.length) return [];
  const refs = ids.map((id) => ({ organizationId: caller.orgId, kind: 'task', id }));
  const visible = await viewableResourceKeys(caller.userId, refs, database);
  if (refs.some((ref) => !visible.has(resourceAccessKey(ref)))) throw new NotFoundError();
  const rows = await database
    .select({
      id: task.id,
      title: task.title,
      description: task.description,
      integrationId: task.sourceIntegrationId,
      externalId: task.externalId,
    })
    .from(task)
    .innerJoin(
      integration,
      and(
        eq(integration.id, task.sourceIntegrationId),
        eq(integration.organizationId, caller.orgId),
      ),
    )
    .where(
      and(
        inArray(task.id, [...ids]),
        eq(task.organizationId, caller.orgId),
        eq(task.source, 'linked'),
        isNotNull(task.externalId),
        isNull(task.archivedAt),
      ),
    )
    .for('share');
  if (rows.length !== ids.length) throw new NotFoundError();
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}
/** Safe source picker metadata; imported titles are read only after resource authorization. */
export async function tailoringSourceOptions(
  caller: TailoringCaller,
  database: Database = db,
): Promise<z.infer<typeof TemplateTailoringSources>> {
  await requireTailoringAuthor(caller, database);
  const sessions = await database
    .select({
      id: agentSession.id,
      createdAt: agentSession.createdAt,
      preview: sql<string>`left(coalesce(jsonb_path_query_first(${agentSessionTranscript.messages}, '$[*] ? (@.role == "user").content[*] ? (@.type == "text").text') #>> '{}',''),120)`,
    })
    .from(agentSession)
    .innerJoin(agentSessionTranscript, eq(agentSessionTranscript.sessionId, agentSession.id))
    .where(
      and(
        eq(agentSession.ownerUserId, caller.userId),
        eq(agentSession.executorKind, 'athena'),
        eq(agentSession.kind, 'chat'),
        eq(agentSession.contextOrganizationId, caller.orgId),
      ),
    )
    .orderBy(desc(agentSession.createdAt))
    .limit(20);
  const candidates = await database
    .select({ id: task.id })
    .from(task)
    .innerJoin(
      integration,
      and(
        eq(integration.id, task.sourceIntegrationId),
        eq(integration.organizationId, caller.orgId),
      ),
    )
    .where(
      and(
        eq(task.organizationId, caller.orgId),
        eq(task.source, 'linked'),
        isNotNull(task.externalId),
        isNull(task.archivedAt),
      ),
    )
    .orderBy(desc(task.createdAt))
    .limit(100);
  const refs = candidates.map(({ id }) => ({ organizationId: caller.orgId, kind: 'task', id }));
  const visible = await viewableResourceKeys(caller.userId, refs, database);
  const ids = refs.filter((ref) => visible.has(resourceAccessKey(ref))).map((ref) => ref.id);
  const importedWork = ids.length
    ? await database
        .select({ id: task.id, label: task.title })
        .from(task)
        .where(inArray(task.id, ids))
    : [];
  return {
    availability: 'available' as const,
    conversations: sessions
      .filter((row) => row.preview.trim())
      .map((row) => ({
        id: row.id,
        label:
          row.preview.trim() + (row.preview.length === 120 ? '…' : '') ||
          `Athena conversation · ${row.createdAt.toISOString().slice(0, 16)} UTC`,
      })),
    importedWork,
  };
}
