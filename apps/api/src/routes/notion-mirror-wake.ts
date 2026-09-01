/**
 * Durable demand state for the Docket-designed Notion mirror.
 *
 * Every signal increments one generation. A completed pass applies only the generation it
 * captured before it started, so a signal that arrives during the pass remains pending.
 */
import { db, integration, notionMirrorState } from '@docket/db';
import { ConnectorConfig } from '@docket/connections/integration-contract';
import { and, eq, inArray, sql } from 'drizzle-orm';

/** The persisted demand and retry state returned after a mirror wake. */
export type NotionMirrorStateRow = typeof notionMirrorState.$inferSelect;

/** Record one reason to reconcile a Notion mirror. */
export async function wakeNotionMirror(
  input: {
    readonly integrationId: string;
    readonly organizationId: string;
    readonly now?: Date;
  },
  writer: Pick<typeof db, 'insert'> = db,
): Promise<NotionMirrorStateRow> {
  const now = input.now ?? new Date();
  const [state] = await writer
    .insert(notionMirrorState)
    .values({
      integrationId: input.integrationId,
      organizationId: input.organizationId,
      desiredGeneration: 1,
      appliedGeneration: 0,
      nextAttemptAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: notionMirrorState.integrationId,
      set: {
        desiredGeneration: sql`${notionMirrorState.desiredGeneration} + 1`,
        nextAttemptAt: now,
        updatedAt: now,
      },
    })
    .returning();
  if (!state) throw new Error('Notion mirror wake did not return state');
  return state;
}

/** Wake every configured Docket-designed Notion mirror in one workspace. */
export async function wakeConfiguredNotionMirrors(
  organizationId: string,
  now = new Date(),
): Promise<number> {
  const rows = await db
    .select({ id: integration.id, config: integration.config })
    .from(integration)
    .where(
      and(
        eq(integration.organizationId, organizationId),
        eq(integration.provider, 'notion'),
        inArray(integration.status, ['connected', 'error']),
      ),
    );
  const configured = rows.filter((row) => {
    const config = ConnectorConfig.safeParse(row.config).data;
    return config?.notionMirror?.containerPageId !== undefined;
  });
  await Promise.all(
    configured.map((row) => wakeNotionMirror({ integrationId: row.id, organizationId, now })),
  );
  return configured.length;
}

/** Capture the generation a leased pass is responsible for. */
export async function captureNotionMirrorGeneration(input: {
  readonly integrationId: string;
  readonly organizationId: string;
  readonly now?: Date;
}): Promise<NotionMirrorStateRow> {
  const now = input.now ?? new Date();
  const [state] = await db
    .insert(notionMirrorState)
    .values({
      integrationId: input.integrationId,
      organizationId: input.organizationId,
      desiredGeneration: 1,
      appliedGeneration: 0,
      nextAttemptAt: now,
      lastAttemptAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: notionMirrorState.integrationId,
      set: { lastAttemptAt: now, updatedAt: now },
    })
    .returning();
  if (!state) throw new Error('Notion mirror attempt did not return state');
  return state;
}

/** Mark exactly the captured generation as reconciled. */
export async function applyNotionMirrorGeneration(input: {
  readonly integrationId: string;
  readonly generation: number;
  readonly now?: Date;
}): Promise<NotionMirrorStateRow> {
  const now = input.now ?? new Date();
  const [state] = await db
    .update(notionMirrorState)
    .set({
      appliedGeneration: sql`greatest(${notionMirrorState.appliedGeneration}, ${input.generation})`,
      nextAttemptAt: sql`case when ${notionMirrorState.desiredGeneration} <= ${input.generation} then null else ${notionMirrorState.nextAttemptAt} end`,
      consecutiveFailures: 0,
      lastSuccessAt: now,
      lastErrorKind: null,
      lastError: null,
      updatedAt: now,
    })
    .where(eq(notionMirrorState.integrationId, input.integrationId))
    .returning();
  if (!state) throw new Error('Notion mirror generation state does not exist');
  return state;
}

/** Keep a failed generation pending and schedule its next bounded retry. */
export async function failNotionMirrorGeneration(input: {
  readonly integrationId: string;
  readonly now?: Date;
  readonly kind: string;
  readonly error: string;
}): Promise<NotionMirrorStateRow> {
  const now = input.now ?? new Date();
  const [state] = await db
    .update(notionMirrorState)
    .set({
      consecutiveFailures: sql`${notionMirrorState.consecutiveFailures} + 1`,
      nextAttemptAt: sql`cast(${now.toISOString()} as timestamp) + (least(900, 5 * power(2, least(${notionMirrorState.consecutiveFailures}, 8))) * interval '1 second')`,
      lastErrorKind: input.kind,
      lastError: input.error,
      updatedAt: now,
    })
    .where(eq(notionMirrorState.integrationId, input.integrationId))
    .returning();
  if (!state) throw new Error('Notion mirror generation state does not exist');
  return state;
}
