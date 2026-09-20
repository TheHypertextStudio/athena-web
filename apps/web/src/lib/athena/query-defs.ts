import {
  AthenaInvocationContext,
  type AthenaPulseOut,
  type ProposalGroupOut,
} from '@docket/athena/agent-contract';
import type { PhoneCallUndoOut as AthenaUndoOut } from '@docket/athena/voice';

import { api } from '@/lib/api';
import { apiQueryOptions, rpcErrorResponse, type RpcResponse, STALE } from '@/lib/query-core';
import { queryKeys } from '@/lib/query-keys';

import {
  adaptAthenaActivity,
  adaptAthenaDetail,
  adaptAthenaOverview,
  type AdaptedAthenaOverview,
} from './api-adapter';
import type {
  PersonalAthenaActivity,
  PersonalAthenaContext,
  PersonalAthenaSessionDetail,
} from './presentation';

/** The grouped response from `GET /v1/me/athena`. */
export type PersonalAthenaQueuePayload = AdaptedAthenaOverview;

/** Personal Athena lifecycle commands. */
export type PersonalAthenaLifecycle = 'run' | 'pause' | 'resume' | 'cancel';

/** Lane-specific cursor used to continue one bounded queue independently. */
export interface PersonalAthenaQueueCursorInput {
  /** Only work started in this workspace; omit for every workspace. */
  readonly workspaceId?: string;
  readonly needsYouCursor?: string;
  readonly workingCursor?: string;
  readonly finishedCursor?: string;
}

/** One backwards page of application-visible activity. */
export interface PersonalAthenaActivityPage {
  readonly items: readonly PersonalAthenaActivity[];
  readonly nextCursor?: string;
}

/** The isolated transport seam for the personal Athena API. */
export interface PersonalAthenaTransport {
  readonly pulse: () => Promise<RpcResponse<AthenaPulseOut>>;
  readonly queue: (
    input?: PersonalAthenaQueueCursorInput,
  ) => Promise<RpcResponse<PersonalAthenaQueuePayload>>;
  readonly detail: (sessionId: string) => Promise<RpcResponse<PersonalAthenaSessionDetail>>;
  readonly activity: (
    sessionId: string,
    cursor: string,
  ) => Promise<RpcResponse<PersonalAthenaActivityPage>>;
  readonly create: (input: {
    readonly prompt: string;
    readonly context?: PersonalAthenaContext;
  }) => Promise<RpcResponse<PersonalAthenaSessionDetail>>;
  readonly sendMessage: (
    sessionId: string,
    input: { readonly body: string },
  ) => Promise<RpcResponse<PersonalAthenaSessionDetail>>;
  readonly decide: (
    sessionId: string,
    activityId: string,
    decision: 'approve' | 'reject' | 'reply',
    input?: { readonly body?: string },
  ) => Promise<RpcResponse<PersonalAthenaSessionDetail>>;
  readonly lifecycle: (
    sessionId: string,
    action: PersonalAthenaLifecycle,
  ) => Promise<RpcResponse<PersonalAthenaSessionDetail>>;
  readonly undoChange: (changeSetId: string) => Promise<RpcResponse<AthenaUndoOut>>;
  /** Still-pending proposal groups for one caller-owned session (a `needs_you` job's ghosts). */
  readonly proposals: (sessionId: string) => Promise<RpcResponse<readonly ProposalGroupOut[]>>;
}

/** Adapt only successful JSON; retain an error body for the shared Problem reader. */
async function adaptedResponse<TApi, TView>(
  responsePromise: Promise<RpcResponse<TApi>>,
  adapt: (value: TApi) => TView,
): Promise<RpcResponse<TView>> {
  const response = await responsePromise;
  return {
    ok: response.ok,
    status: response.status,
    json: async () => {
      const body = await response.json();
      return response.ok ? adapt(body) : (body as unknown as TView);
    },
  };
}

/** Strip display-only labels so a context matches the API's invocation shape. */
export function toInvocationContext(
  context?: PersonalAthenaContext,
): AthenaInvocationContext | undefined {
  if (!context?.workspaceId && !context?.source) return undefined;
  return AthenaInvocationContext.parse({
    ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
    ...(context.source ? { source: { type: context.source.type, id: context.source.id } } : {}),
  });
}

function detailRequest(sessionId: string): Promise<RpcResponse<PersonalAthenaSessionDetail>> {
  return adaptedResponse(
    api.v1.me.athena.sessions[':id'].$get({ param: { id: sessionId }, query: {} }),
    adaptAthenaDetail,
  );
}

/** Default transport backed by the platform's typed Hono personal-Athena contract. */
export const personalAthenaTransport: PersonalAthenaTransport = {
  pulse: () => api.v1.me.athena.pulse.$get(),
  queue: (input = {}) =>
    adaptedResponse(api.v1.me.athena.$get({ query: input }), adaptAthenaOverview),
  detail: detailRequest,
  activity: (sessionId, cursor) =>
    adaptedResponse(
      api.v1.me.athena.sessions[':id'].activity.$get({
        param: { id: sessionId },
        query: { cursor },
      }),
      (page) => {
        const items = page.items
          .map(adaptAthenaActivity)
          .filter((item): item is PersonalAthenaActivity => item !== null);
        return { items, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) };
      },
    ),
  create: (input) => {
    const context = toInvocationContext(input.context);
    return adaptedResponse(
      api.v1.me.athena.sessions.$post({
        json: { prompt: input.prompt, ...(context ? { context } : {}) },
      }),
      adaptAthenaDetail,
    );
  },
  sendMessage: (sessionId, input) =>
    adaptedResponse(
      api.v1.me.athena.sessions[':id'].messages.$post({
        param: { id: sessionId },
        json: input,
      }),
      adaptAthenaDetail,
    ),
  decide: async (sessionId, activityId, decision, input) => {
    const param = { id: sessionId, activityId };
    const response =
      decision === 'reply'
        ? await api.v1.me.athena.sessions[':id'].activity[':activityId'].reply.$post({
            param,
            json: { body: input?.body ?? '' },
          })
        : await api.v1.me.athena.sessions[':id'].activity[':activityId'].decision.$put({
            param,
            json: { decision: decision === 'reject' ? 'rejected' : 'approved' },
          });
    if (!response.ok) return rpcErrorResponse(response);
    return detailRequest(sessionId);
  },
  lifecycle: async (sessionId, action) => {
    const param = { id: sessionId };
    const response =
      action === 'run'
        ? await api.v1.me.athena.sessions[':id'].run.$post({ param, json: {} })
        : action === 'pause'
          ? await api.v1.me.athena.sessions[':id'].pause.$post({ param })
          : action === 'resume'
            ? await api.v1.me.athena.sessions[':id'].resume.$post({ param })
            : await api.v1.me.athena.sessions[':id'].cancel.$post({ param });
    if (!response.ok) return rpcErrorResponse(response);
    return detailRequest(sessionId);
  },
  undoChange: (changeSetId) =>
    api.v1.me.athena.changes[':changeSetId'].undo.$post({ param: { changeSetId } }),
  proposals: (sessionId) =>
    adaptedResponse(
      api.v1.me.athena.sessions[':id'].proposals.$get({
        param: { id: sessionId },
        query: { limit: '100' },
      }),
      (page) => page.items,
    ),
};

/** Compact live-count definition for the closed ambient pulse. */
export function personalAthenaPulseDef(
  transport: PersonalAthenaTransport = personalAthenaTransport,
  enabled = true,
) {
  return apiQueryOptions(
    queryKeys.athenaPulse(),
    () => transport.pulse(),
    'Could not load Athena status.',
    { enabled, staleTime: STALE.volatile },
  );
}

/**
 * Typed live queue definition shared by the shell dock and full Athena workspace.
 *
 * @param transport - The personal Athena transport.
 * @param enabled - Whether the read runs.
 * @param workspaceId - Scope the queue to work started in this workspace; omit for all of it.
 */
export function personalAthenaQueueDef(
  transport: PersonalAthenaTransport = personalAthenaTransport,
  enabled = true,
  workspaceId?: string,
) {
  const scoped = workspaceId !== undefined;
  return apiQueryOptions(
    scoped ? queryKeys.athenaWorkspaceQueue(workspaceId) : queryKeys.athena(),
    () => (scoped ? transport.queue({ workspaceId }) : transport.queue()),
    'Could not load Athena work.',
    { enabled, staleTime: STALE.volatile },
  );
}

/** Typed selected-work definition shared by every workbench host. */
export function personalAthenaDetailDef(
  sessionId: string,
  transport: PersonalAthenaTransport = personalAthenaTransport,
  hostVisible = true,
) {
  return apiQueryOptions(
    queryKeys.athenaSession(sessionId),
    () => transport.detail(sessionId),
    'Could not load this Athena work.',
    { enabled: hostVisible && sessionId.length > 0, staleTime: STALE.volatile },
  );
}

/** Typed pending-proposals definition for one personal Athena session (a `needs_you` job's ghosts). */
export function personalAthenaProposalsDef(
  sessionId: string,
  transport: PersonalAthenaTransport = personalAthenaTransport,
) {
  return apiQueryOptions(
    queryKeys.athenaSessionProposals(sessionId),
    () => transport.proposals(sessionId),
    'Could not load the proposed changes.',
    { staleTime: STALE.volatile },
  );
}

/** Build the full personal Athena URL while retaining invocation, selection, and composer intent. */
export function athenaHref(
  context?: PersonalAthenaContext | null,
  sessionId?: string | null,
  startNewWork = false,
): string {
  const search = new URLSearchParams();
  if (context?.workspaceId) search.set('workspace', context.workspaceId);
  if (context?.source) {
    search.set('context', `${context.source.type}:${context.source.id}`);
    if (context.source.label) search.set('contextLabel', context.source.label);
  }
  if (startNewWork) search.set('new', '1');
  if (sessionId) search.set('session', sessionId);
  const query = search.toString();
  return query ? `/athena?${query}` : '/athena';
}
