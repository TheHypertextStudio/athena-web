import { AthenaInvocationContext, type AthenaPulseOut } from '@docket/types';

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
  readonly message: (
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

/** Strip display-only source labels before sending an invocation context to the API. */
function apiContext(context?: PersonalAthenaContext): AthenaInvocationContext | undefined {
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
    const context = apiContext(input.context);
    return adaptedResponse(
      api.v1.me.athena.sessions.$post({
        json: { prompt: input.prompt, ...(context ? { context } : {}) },
      }),
      adaptAthenaDetail,
    );
  },
  message: (sessionId, input) =>
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
        : decision === 'reject'
          ? await api.v1.me.athena.sessions[':id'].activity[':activityId'].reject.$post({
              param,
              json: {},
            })
          : await api.v1.me.athena.sessions[':id'].activity[':activityId'].approve.$post({
              param,
              json: {},
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

/** Typed live queue definition shared by the shell dock and full Athena workspace. */
export function personalAthenaQueueDef(
  transport: PersonalAthenaTransport = personalAthenaTransport,
  enabled = true,
) {
  return apiQueryOptions(
    queryKeys.athena(),
    () => transport.queue(),
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
