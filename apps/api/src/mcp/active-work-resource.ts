/**
 * The Hub MCP resource that reports the caller's current Time Ledger record.
 */
import { db, timeRecord } from '@docket/db';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { ActiveWorkOut, type ActiveWorkOut as ActiveWorkPayload } from '../contracts/active-work';
import { loadVisibleTaskContext } from './active-work-task-context';
import type { McpContext } from './auth';
import type { McpRegistrar } from './catalog';
import { jsonRead } from './resource-statics';
import { RESOURCE_READ_SCOPE, requireScope } from './scope';

export { loadVisibleTaskContext } from './active-work-task-context';

interface CurrentRecord {
  readonly id: string;
  readonly status: string;
  readonly taskId: string | null;
}

/** Return the most relevant active record, prioritizing work that is still open. */
async function currentRecord(userId: string): Promise<CurrentRecord | null> {
  const [record] = await db
    .select({
      id: timeRecord.id,
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
function recordPayload(record: CurrentRecord, observedAt: string): ActiveWorkPayload {
  return {
    schemaVersion: 'active-work/1',
    observedAt,
    tracking: record.status === 'open' ? 'running' : 'paused',
    recordId: record.id,
    task: null,
  };
}

/** Read the caller's record without exposing its title until its anchored task is visible. */
async function readActiveWork(ctx: McpContext): Promise<ActiveWorkPayload> {
  requireScope(ctx.scopes, RESOURCE_READ_SCOPE);
  const observedAt = new Date().toISOString();
  if (ctx.principal.kind !== 'user') {
    return {
      schemaVersion: 'active-work/1',
      observedAt,
      tracking: 'idle',
      recordId: null,
      task: null,
    };
  }

  const record = await currentRecord(ctx.principal.userId);
  if (!record) {
    return {
      schemaVersion: 'active-work/1',
      observedAt,
      tracking: 'idle',
      recordId: null,
      task: null,
    };
  }
  if (!record.taskId) return recordPayload(record, observedAt);

  const task = await loadVisibleTaskContext(ctx.principal.userId, record.taskId);
  return ActiveWorkOut.parse(
    task ? { ...recordPayload(record, observedAt), task } : recordPayload(record, observedAt),
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
