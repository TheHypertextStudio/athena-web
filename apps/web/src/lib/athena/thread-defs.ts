'use client';

/**
 * The person's one Athena conversation: a live read with an SSE tail while a turn is in flight.
 *
 * The poll is the delivery guarantee; the stream only makes it faster. The API closes the stream
 * when the session settles, so the subscription exists only while the thread reports a
 * non-terminal status.
 */
import type { AthenaSessionDetailOut, SessionActivityOut } from '@docket/athena/agent-contract';
import { useQueryClient, type QueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useEffect } from 'react';

import { api } from '@/lib/api';
import { readProblemError } from '@/lib/problem';
import { apiQueryOptions, STALE } from '@/lib/query-core';
import { queryKeys, useLiveApiQuery } from '@/lib/query';

import type { PersonalAthenaContext } from './presentation';
import { toInvocationContext } from './query-defs';

/** Session states after which the API closes the activity stream. */
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'canceled']);

/** SSE event names, one per activity type. */
const ACTIVITY_EVENTS = ['thought', 'action', 'response', 'elicitation', 'error'] as const;

/** Poll cadence while Athena is working. */
const ACTIVE_POLL_MS = 2_000;

/** Poll cadence for an idle thread. */
const IDLE_POLL_MS = 10_000;

/** Definition for `GET /v1/me/athena/chat`. */
export function personalThreadDef() {
  return apiQueryOptions<AthenaSessionDetailOut>(
    queryKeys.athenaChat(),
    () => api.v1.me.athena.chat.$get({ query: {} }),
    'Could not open the conversation.',
    { staleTime: STALE.realtime },
  );
}

/**
 * Append one message to the conversation and drive a turn over it.
 *
 * @param body - What the person wrote.
 * @param context - The attached page, if any; labels are stripped before sending.
 * @returns the updated conversation, for the caller to write into the cache.
 * @throws the problem-detail error when the API refuses the message.
 */
export async function sendPersonalMessage(
  body: string,
  context?: PersonalAthenaContext,
): Promise<AthenaSessionDetailOut> {
  const invocation = toInvocationContext(context);
  const response = await api.v1.me.athena.chat.messages.$post({
    json: { body, ...(invocation ? { context: invocation } : {}) },
  });
  if (!response.ok) throw await readProblemError(response, 'Athena could not answer right now.');
  return await response.json();
}

/** Insert one streamed activity into the cached conversation, deduplicating by id. */
function mergeActivity(queryClient: QueryClient, activity: SessionActivityOut): void {
  queryClient.setQueryData<AthenaSessionDetailOut>(queryKeys.athenaChat(), (thread) => {
    if (!thread || thread.id !== activity.sessionId) return thread;
    const existing = thread.activities.findIndex((entry) => entry.id === activity.id);
    if (existing >= 0) {
      const activities = thread.activities.map((entry, index) =>
        index === existing ? activity : entry,
      );
      return { ...thread, activities };
    }
    const activities = [...thread.activities, activity].sort((a, b) => a.id.localeCompare(b.id));
    return { ...thread, activities };
  });
}

/** Subscribe to the conversation's stream while a turn is in flight. */
function usePersonalStream(thread: AthenaSessionDetailOut | undefined): void {
  const queryClient = useQueryClient();
  const sessionId = thread && !TERMINAL_STATUSES.has(thread.status) ? thread.id : null;
  useEffect(() => {
    if (sessionId === null) return;
    const source = new EventSource(
      `/v1/me/athena/sessions/${encodeURIComponent(sessionId)}/stream`,
    );
    const merge = (event: MessageEvent): void => {
      try {
        mergeActivity(queryClient, JSON.parse(String(event.data)) as SessionActivityOut);
      } catch {
        // A malformed frame is dropped; the poll delivers the activity on its next pass.
      }
    };
    for (const eventName of ACTIVITY_EVENTS) source.addEventListener(eventName, merge);
    source.onerror = () => {
      source.close();
      void queryClient.invalidateQueries({ queryKey: queryKeys.athenaChat() });
    };
    return () => {
      source.close();
    };
  }, [queryClient, sessionId]);
}

/** The conversation as a live read: focus-gated polling plus the stream. */
export function usePersonalThread(): UseQueryResult<AthenaSessionDetailOut> {
  const queryClient = useQueryClient();
  // The cached thread decides the cadence before this render's query result exists; the query's
  // own subscription re-renders the hook when the status changes, so the interval follows.
  const cached = queryClient.getQueryData<AthenaSessionDetailOut>(queryKeys.athenaChat());
  const active = cached ? !TERMINAL_STATUSES.has(cached.status) : false;
  const query = useLiveApiQuery(personalThreadDef(), active ? ACTIVE_POLL_MS : IDLE_POLL_MS);
  usePersonalStream(query.data);
  return query;
}
