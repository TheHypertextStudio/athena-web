'use client';

/**
 * Typed reads and writes for the org's persistent Athena chat thread.
 *
 * @remarks
 * The conversation surface reads through the standard query layer like every other surface, with
 * one live enhancement layered on top: while a turn is in flight the hook also subscribes to the
 * session's Server-Sent Events stream, so activities — including MCP app cards — land in the
 * thread as the turn produces them rather than on the next poll. The focus-gated poll stays on
 * underneath as the delivery guarantee; the stream only ever makes it faster.
 */
import type { AgentSessionDetailOut, SessionActivityOut } from '@docket/types';
import { useQueryClient, type QueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useEffect } from 'react';

import { api } from '@/lib/api';
import { readProblemError } from '@/lib/problem';
import { apiQueryOptions, STALE } from '@/lib/query-core';
import { queryKeys, useApiQuery } from '@/lib/query';

/** Session states after which the API closes the activity stream. */
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'canceled']);

/** The SSE event names the activity stream emits (one per activity type). */
const ACTIVITY_EVENTS = ['thought', 'action', 'response', 'elicitation', 'error'] as const;

/** Poll cadence while Athena is working on the thread. */
const ACTIVE_POLL_MS = 2_000;

/** Poll cadence for an idle thread (a reply can still arrive from another door). */
const IDLE_POLL_MS = 10_000;

/** Definition for `GET /v1/orgs/:orgId/sessions/chat` — the org's persistent thread. */
export function orgChatThreadDef(orgId: string) {
  return apiQueryOptions<AgentSessionDetailOut>(
    queryKeys.chatThread(orgId),
    () => api.v1.orgs[':orgId'].sessions.chat.$get({ param: { orgId } }),
    'Could not open the conversation.',
    { staleTime: STALE.realtime },
  );
}

/**
 * Fetch the thread once, without touching the cache.
 *
 * @remarks
 * For the one caller that must apply the result inside a view transition (the proposal-settle
 * morph): `fetchQuery` writes the cache the moment the response resolves, which is outside any
 * transition callback, so that path fetches here and commits via `setQueryData` itself.
 *
 * @param orgId - The org whose thread to fetch.
 * @returns the current thread.
 * @throws the problem-detail error when the read fails.
 */
export async function fetchOrgChatThread(orgId: string): Promise<AgentSessionDetailOut> {
  const response = await api.v1.orgs[':orgId'].sessions.chat.$get({ param: { orgId } });
  if (!response.ok) throw await readProblemError(response, 'Could not open the conversation.');
  return await response.json();
}

/**
 * Append one entry to the org thread and drive a fresh turn over it.
 *
 * @param orgId - The org whose thread receives the entry.
 * @param body - The message content, attributed to the caller.
 * @returns the updated thread, which the caller should write into the query cache.
 * @throws the problem-detail error when the API refuses the message.
 */
export async function sendOrgChatMessage(
  orgId: string,
  body: string,
): Promise<AgentSessionDetailOut> {
  const response = await api.v1.orgs[':orgId'].sessions.chat.messages.$post({
    param: { orgId },
    json: { body },
  });
  if (!response.ok) throw await readProblemError(response, 'Athena could not answer right now.');
  return await response.json();
}

/** Insert one streamed activity into the cached thread, deduplicating by activity id. */
function mergeActivity(
  queryClient: QueryClient,
  orgId: string,
  activity: SessionActivityOut,
): void {
  queryClient.setQueryData<AgentSessionDetailOut>(queryKeys.chatThread(orgId), (thread) => {
    if (!thread || thread.id !== activity.sessionId) return thread;
    const existing = thread.activities.findIndex((entry) => entry.id === activity.id);
    const activities =
      existing >= 0
        ? thread.activities.map((entry, index) => (index === existing ? activity : entry))
        : [...thread.activities, activity].sort((a, b) => a.id.localeCompare(b.id));
    return { ...thread, activities };
  });
}

/**
 * Subscribe to the thread's SSE activity stream while a turn is in flight.
 *
 * @remarks
 * The API replays history and then tails the session until it settles terminally, closing the
 * stream when it does. `EventSource` would then reconnect forever against a settled session, so
 * the subscription exists only while the thread reports a non-terminal status; the poll under it
 * is what notices the terminal state (and any turn started from another door). A stream error
 * simply falls back to that poll — the seam promises delivery, the stream promises immediacy.
 */
function useOrgChatStream(orgId: string, thread: AgentSessionDetailOut | undefined): void {
  const queryClient = useQueryClient();
  const sessionId = thread && !TERMINAL_STATUSES.has(thread.status) ? thread.id : null;
  useEffect(() => {
    if (sessionId === null) return;
    const source = new EventSource(
      `/v1/orgs/${encodeURIComponent(orgId)}/sessions/${encodeURIComponent(sessionId)}/stream`,
    );
    const merge = (event: MessageEvent): void => {
      try {
        mergeActivity(queryClient, orgId, JSON.parse(String(event.data)) as SessionActivityOut);
      } catch {
        // A malformed frame is dropped; the poll delivers the activity on its next pass.
      }
    };
    for (const eventName of ACTIVITY_EVENTS) source.addEventListener(eventName, merge);
    source.onerror = () => {
      // The server closes the stream when the session settles; refresh so the poll learns the
      // terminal status now instead of on its next interval.
      source.close();
      void queryClient.invalidateQueries({ queryKey: queryKeys.chatThread(orgId) });
    };
    return () => {
      source.close();
    };
  }, [orgId, sessionId, queryClient]);
}

/**
 * The org chat thread as a live read: focus-gated polling plus the SSE enhancement.
 *
 * @remarks
 * The poll interval follows the thread's own state — quick while a turn is in flight, relaxed
 * while idle — which is why this reads through a function-form `refetchInterval` rather than the
 * fixed-interval `useLiveApiQuery`. Focus gating is the same either way.
 *
 * @param orgId - The org whose persistent thread to read.
 * @returns the thread query result; `data` is the full {@link AgentSessionDetailOut}.
 */
export function useOrgChatThread(orgId: string): UseQueryResult<AgentSessionDetailOut> {
  const query = useApiQuery({
    ...orgChatThreadDef(orgId),
    refetchInterval: (active) => {
      const status = active.state.data?.status;
      return status !== undefined && !TERMINAL_STATUSES.has(status) ? ACTIVE_POLL_MS : IDLE_POLL_MS;
    },
  });
  useOrgChatStream(orgId, query.data);
  return query;
}
