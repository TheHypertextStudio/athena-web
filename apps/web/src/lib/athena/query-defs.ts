import { apiQueryOptions, type RpcResponse, STALE } from '@/lib/query-core';
import { queryKeys } from '@/lib/query-keys';

import {
  adaptAthenaDetail,
  adaptAthenaOverview,
  type AdaptedAthenaOverview,
  type AthenaApiOverview,
  type AthenaApiSessionDetail,
  type AthenaApiSessionSummary,
} from './api-adapter';
import type { PersonalAthenaContext, PersonalAthenaSessionDetail } from './presentation';

/** The grouped response from `GET /v1/me/athena`. */
export type PersonalAthenaQueuePayload = AdaptedAthenaOverview;

/** Personal Athena lifecycle commands. */
export type PersonalAthenaLifecycle = 'run' | 'pause' | 'resume' | 'cancel';

/** The isolated transport seam for the personal Athena API. */
export interface PersonalAthenaTransport {
  readonly queue: () => Promise<RpcResponse<PersonalAthenaQueuePayload>>;
  readonly detail: (sessionId: string) => Promise<RpcResponse<PersonalAthenaSessionDetail>>;
  readonly create: (input: {
    readonly prompt: string;
    readonly context?: PersonalAthenaContext;
  }) => Promise<RpcResponse<PersonalAthenaSessionDetail>>;
  readonly message: (
    sessionId: string,
    input: { readonly body: string },
  ) => Promise<RpcResponse<PersonalAthenaSessionDetail>>;
  readonly decide: (
    activityId: string,
    decision: 'approve' | 'reject' | 'reply',
    input?: { readonly body?: string },
  ) => Promise<RpcResponse<PersonalAthenaSessionDetail>>;
  readonly lifecycle: (
    sessionId: string,
    action: PersonalAthenaLifecycle,
  ) => Promise<RpcResponse<PersonalAthenaSessionDetail>>;
}

/** Create a typed response over the same-origin personal API. */
async function request<T>(path: string, init?: RequestInit): Promise<RpcResponse<T>> {
  const response = await fetch(path, { ...init, credentials: 'include' });
  return {
    ok: response.ok,
    status: response.status,
    json: async () => (await response.json()) as T,
  };
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
function apiContext(context?: PersonalAthenaContext): PersonalAthenaContext | undefined {
  if (!context) return undefined;
  return {
    ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
    ...(context.source ? { source: { type: context.source.type, id: context.source.id } } : {}),
  };
}

function detailRequest(sessionId: string): Promise<RpcResponse<PersonalAthenaSessionDetail>> {
  return adaptedResponse(
    request<AthenaApiSessionDetail>(`/v1/me/athena/sessions/${encodeURIComponent(sessionId)}`),
    adaptAthenaDetail,
  );
}

/** Default same-origin transport, localized until the generated Hono client includes this lane. */
export const personalAthenaTransport: PersonalAthenaTransport = {
  queue: () => adaptedResponse(request<AthenaApiOverview>('/v1/me/athena'), adaptAthenaOverview),
  detail: detailRequest,
  create: (input) =>
    adaptedResponse(
      request<AthenaApiSessionDetail>('/v1/me/athena/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: input.prompt, context: apiContext(input.context) }),
      }),
      adaptAthenaDetail,
    ),
  message: (sessionId, input) =>
    adaptedResponse(
      request<AthenaApiSessionDetail>(
        `/v1/me/athena/sessions/${encodeURIComponent(sessionId)}/messages`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        },
      ),
      adaptAthenaDetail,
    ),
  decide: async (activityId, decision, input) => {
    const response = await request<unknown>(
      `/v1/me/athena/activity/${encodeURIComponent(activityId)}/${decision}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        ...(input ? { body: JSON.stringify(input) } : {}),
      },
    );
    if (!response.ok) return response as RpcResponse<PersonalAthenaSessionDetail>;
    const activity = (await response.json()) as { readonly sessionId?: string };
    return activity.sessionId
      ? detailRequest(activity.sessionId)
      : (response as RpcResponse<PersonalAthenaSessionDetail>);
  },
  lifecycle: async (sessionId, action) => {
    const response = await request<AthenaApiSessionSummary>(
      `/v1/me/athena/sessions/${encodeURIComponent(sessionId)}/${action}`,
      {
        method: 'POST',
      },
    );
    if (!response.ok) return response as unknown as RpcResponse<PersonalAthenaSessionDetail>;
    return detailRequest(sessionId);
  },
};

/** Typed live queue definition shared by the shell dock and full Athena workspace. */
export function personalAthenaQueueDef(
  transport: PersonalAthenaTransport = personalAthenaTransport,
) {
  return apiQueryOptions(
    queryKeys.athena(),
    () => transport.queue(),
    'Could not load Athena work.',
    { staleTime: STALE.volatile },
  );
}

/** Typed selected-work definition shared by every workbench host. */
export function personalAthenaDetailDef(
  sessionId: string,
  transport: PersonalAthenaTransport = personalAthenaTransport,
) {
  return apiQueryOptions(
    queryKeys.athenaSession(sessionId),
    () => transport.detail(sessionId),
    'Could not load this Athena work.',
    { enabled: sessionId.length > 0, staleTime: STALE.volatile },
  );
}

/** Build the full personal Athena URL while retaining the invoking object and queue selection. */
export function athenaHref(
  context?: PersonalAthenaContext | null,
  sessionId?: string | null,
): string {
  const search = new URLSearchParams();
  if (context?.workspaceId) search.set('workspace', context.workspaceId);
  if (context?.source) {
    search.set('context', `${context.source.type}:${context.source.id}`);
    if (context.source.label) search.set('contextLabel', context.source.label);
  }
  if (sessionId) search.set('session', sessionId);
  const query = search.toString();
  return query ? `/athena?${query}` : '/athena';
}
