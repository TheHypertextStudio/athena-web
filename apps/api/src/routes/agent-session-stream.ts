/** Persisted organization-session replay and live-tail streaming. */
import { agentSession, db, sessionActivity } from '@docket/db';
import { and, asc, eq, gt, or } from 'drizzle-orm';
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';

import type { AppEnv } from '../context';
import { declareStreaming } from '../lib/sse-headers';

import {
  canContinueSessionDelivery,
  type SessionRow,
  toActivityOut,
} from './agent-session-helpers';
import { unknownStreamCursor } from './stream-contracts';

const STREAM_POLL_MS = 750;
const STREAM_HEARTBEAT_MS = 15_000;

interface ActivityStreamCursor {
  readonly createdAt: Date;
  readonly id: string;
}

async function activitiesAfter(
  sessionId: string,
  cursor: ActivityStreamCursor | null,
): Promise<(typeof sessionActivity.$inferSelect)[]> {
  return db
    .select()
    .from(sessionActivity)
    .where(
      and(
        eq(sessionActivity.sessionId, sessionId),
        cursor
          ? or(
              gt(sessionActivity.createdAt, cursor.createdAt),
              and(
                eq(sessionActivity.createdAt, cursor.createdAt),
                gt(sessionActivity.id, cursor.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(asc(sessionActivity.createdAt), asc(sessionActivity.id));
}

async function persistedCursor(
  sessionId: string,
  lastEventId: string | undefined,
): Promise<ActivityStreamCursor | null> {
  if (lastEventId === undefined) return null;
  const [cursor] = await db
    .select({ createdAt: sessionActivity.createdAt, id: sessionActivity.id })
    .from(sessionActivity)
    .where(and(eq(sessionActivity.sessionId, sessionId), eq(sessionActivity.id, lastEventId)))
    .limit(1);
  if (!cursor) throw unknownStreamCursor();
  return cursor;
}

/** Open an all-history replay followed by a compound-cursor live tail. */
export async function streamOrganizationActivity(
  c: Context<AppEnv>,
  session: SessionRow,
): Promise<Response> {
  const cursorAtOpen = await persistedCursor(session.id, c.req.header('last-event-id'));
  const replay = await activitiesAfter(session.id, cursorAtOpen);
  const terminal = new Set(['completed', 'failed', 'canceled']);
  return declareStreaming(
    streamSSE(c, async (stream) => {
      let cursor = cursorAtOpen;
      if (replay.length > 0) {
        if (!(await canContinueSessionDelivery(c, session))) {
          await stream.close();
          return;
        }
        await stream.write(
          replay
            .map(
              (activity) =>
                `event: ${activity.type}\ndata: ${JSON.stringify(toActivityOut(activity))}\nid: ${activity.id}\n\n`,
            )
            .join(''),
        );
        const last = replay.at(-1);
        if (last) cursor = { createdAt: last.createdAt, id: last.id };
      }
      let status = session.status;
      let sincePing = 0;
      while (!terminal.has(status) && !stream.aborted) {
        await new Promise((resolve) => setTimeout(resolve, STREAM_POLL_MS));
        for (const activity of await activitiesAfter(session.id, cursor)) {
          if (!(await canContinueSessionDelivery(c, session))) {
            await stream.close();
            return;
          }
          await stream.writeSSE({
            id: activity.id,
            event: activity.type,
            data: JSON.stringify(toActivityOut(activity)),
          });
          cursor = { createdAt: activity.createdAt, id: activity.id };
        }
        sincePing += STREAM_POLL_MS;
        if (sincePing >= STREAM_HEARTBEAT_MS) {
          await stream.writeSSE({ event: 'ping', data: '{}' });
          sincePing = 0;
        }
        const [current] = await db
          .select({ status: agentSession.status })
          .from(agentSession)
          .where(eq(agentSession.id, session.id))
          .limit(1);
        status = current?.status ?? 'completed';
      }
      await stream.close();
    }),
  );
}
