'use client';

/**
 * The elicitation data seam: queries, the answer mutation, presence, and push registration.
 *
 * @remarks
 * Everything the elicitation surface reads or writes goes through the typed TanStack layer in
 * `@/lib/query` — no component calls `api.v1.*` and no component hand-rolls `useEffect` + `fetch`.
 * Two things here are not ordinary reads and are worth naming:
 *
 * - **Presence** is a write on a timer, not a query. The surface tells the server it is open and
 *   focused; the server uses that to decide whether the *next* question is live. Sending it on a
 *   timer rather than once means a tab left open behind another window stops counting on its own.
 * - **Liveness** is a short live poll, not a persistent stream. {@link useLiveElicitations} refreshes
 *   on {@link ELICITATION_LIVE_INTERVAL_MS}, so a question raised by an agent working in the
 *   background appears well inside the two-second bar with no refresh. A held-open `EventSource`
 *   would push it marginally faster and cost more than it is worth: an always-open connection means
 *   Playwright's `networkidle` never settles, which breaks this repo's own screenshot and e2e
 *   tooling on every page that mounts the surface. Measured: 25s and still not idle.
 */
import type {
  AthenaPresenceOut,
  ElicitationListOut,
  ElicitationOut,
} from '@docket/athena/elicitation-api';
import { useEffect, useRef } from 'react';

import { api } from '@/lib/api';
import { apiQueryOptions, STALE, unwrap } from '@/lib/query-core';
import { useApiMutation, useLiveApiQuery } from '@/lib/query';

/**
 * Query keys for the elicitation surface.
 *
 * @remarks
 * Declared here rather than in the shared `queryKeys` registry because this surface owns them
 * outright and nothing else invalidates them; the shape matches the registry's convention
 * (`['me', <surface>, …]`) so they read the same in devtools.
 */
export const elicitationKeys = {
  /** Every question addressed to the caller. */
  all: () => ['me', 'elicitations'] as const,
  /** Whether the caller is being treated as present. */
  presence: () => ['me', 'elicitations', 'presence'] as const,
  /** The browser push application server key. */
  pushConfig: () => ['me', 'web-push', 'config'] as const,
  /** Whether the caller has a registered browser push subscription. */
  pushSubscription: () => ['me', 'web-push', 'subscription'] as const,
};

/** Read every question addressed to the caller. */
export const elicitationsDef = () =>
  apiQueryOptions<ElicitationListOut>(
    elicitationKeys.all(),
    () => api.v1.me.elicitations.$get(),
    'Could not load what Athena is waiting on.',
    { staleTime: STALE.volatile },
  );

/** Read the browser push application server key. */
export const webPushConfigDef = () =>
  apiQueryOptions<{ publicKey: string | null }>(
    elicitationKeys.pushConfig(),
    () => api.v1.me['web-push'].config.$get(),
    'Could not check whether notifications are available.',
    { staleTime: STALE.static },
  );

/** Read whether the caller already has a browser push subscription. */
export const webPushSubscriptionDef = () =>
  apiQueryOptions<{ subscribed: boolean }>(
    elicitationKeys.pushSubscription(),
    () => api.v1.me['web-push'].subscription.$get(),
    'Could not check your notification settings.',
    { staleTime: STALE.standard },
  );

/** One rejected field of a submitted answer, as the card renders it. */
export interface AnswerRejection {
  /** Dotted path to the offending value; `''` addresses the answer as a whole. */
  readonly path: string;
  /** Docket's own sentence. Named `text`, never `message` — see `ElicitationFieldError`. */
  readonly text: string;
}

/** What submitting an answer produced. */
export type AnswerOutcome =
  | { readonly ok: true; readonly elicitation: ElicitationOut }
  | { readonly ok: false; readonly errors: readonly AnswerRejection[] };

/**
 * Submit one answer.
 *
 * @remarks
 * A `422` is a *result*, not a thrown error: the server refused specific fields and the card has to
 * keep rendering with the person's other input intact. Anything else falls through to the shared
 * error path, which is what surfaces a real outage rather than pretending the form was wrong.
 *
 * @returns The TanStack mutation; its data is an {@link AnswerOutcome}.
 */
export function useAnswerElicitation(): ReturnType<
  typeof useApiMutation<AnswerOutcome, { id: string; value: unknown }>
> {
  return useApiMutation<AnswerOutcome, { id: string; value: unknown }>({
    mutationFn: async ({ id, value }) => {
      const response = await api.v1.me.elicitations[':id'].answer.$post({
        param: { id },
        json: { value },
      });
      if (response.status === 422) {
        const body = (await response.json()) as { errors: readonly AnswerRejection[] };
        return { ok: false, errors: body.errors };
      }
      const elicitation = await unwrap(
        async () => response,
        'Athena could not record that answer.',
      );
      return { ok: true, elicitation: elicitation };
    },
    invalidateKeys: [elicitationKeys.all()],
  });
}

/** Register a browser push subscription so time-sensitive questions can reach the caller. */
export function useRegisterWebPush(): ReturnType<
  typeof useApiMutation<{ subscribed: boolean }, PushSubscriptionJSON>
> {
  return useApiMutation<{ subscribed: boolean }, PushSubscriptionJSON>({
    mutationFn: (subscription) =>
      unwrap(
        () =>
          api.v1.me['web-push'].subscription.$post({
            json: subscription as never,
          }),
        'Could not turn on notifications.',
      ),
    invalidateKeys: [elicitationKeys.pushSubscription()],
  });
}

/** How often the surface tells the server it is open and focused. */
export const PRESENCE_HEARTBEAT_MS = 30_000;

/** Record whether the caller is watching Athena right now. */
export function useRecordPresence(): ReturnType<typeof useApiMutation<AthenaPresenceOut, boolean>> {
  return useApiMutation<AthenaPresenceOut, boolean>({
    mutationFn: (focused) =>
      unwrap(
        () => api.v1.me.elicitations.presence.$post({ json: { focused } }),
        'Could not record that you are here.',
      ),
  });
}

/**
 * Tell the server this surface is open and focused, for as long as it is.
 *
 * @remarks
 * Sends immediately, then on a timer, and sends one final `focused: false` when the surface closes
 * or the tab is hidden — so "the user is easily accessible" stops being true the moment it stops
 * being true, rather than decaying silently after the window expires.
 *
 * A failed heartbeat is deliberately not surfaced: presence is an optimization for *the next*
 * question, and an error banner for "we could not tell the server you are looking at this" would be
 * noise about something the person cannot act on. The consequence of a lost heartbeat is a push
 * notification they did not strictly need, which is the safe direction to fail in.
 *
 * @param enabled - Whether this surface should claim presence at all.
 */
export function useAthenaPresence(enabled = true): void {
  const record = useRecordPresence();
  const beatRef = useRef(record.mutate);
  beatRef.current = record.mutate;

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;
    const beat = (focused: boolean): void => {
      beatRef.current(focused, { onError: () => undefined });
    };
    const onVisibility = (): void => {
      beat(document.visibilityState === 'visible' && document.hasFocus());
    };
    beat(document.visibilityState === 'visible');
    const timer = setInterval(onVisibility, PRESENCE_HEARTBEAT_MS);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onVisibility);
    window.addEventListener('blur', onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onVisibility);
      window.removeEventListener('blur', onVisibility);
      beat(false);
    };
  }, [enabled]);
}

/** How often the surface re-reads what Athena is waiting on. */
export const ELICITATION_LIVE_INTERVAL_MS = 1_500;

/** Everything the elicitation surface needs to render. */
export interface LiveElicitations {
  /** Questions still waiting on the caller. */
  readonly pending: readonly ElicitationOut[];
  /** Questions that have been settled, most recently first. */
  readonly settled: readonly ElicitationOut[];
  /** Whether the first load is still in flight. */
  readonly loading: boolean;
  /** Whether the list could not be loaded at all. */
  readonly failed: boolean;
}

/**
 * The caller's questions, refreshed live while the surface is open.
 *
 * @remarks
 * `useLiveApiQuery` is the repo's own primitive for fast-moving data and pauses on a hidden tab, so
 * a background window is not re-asking every 1.5 seconds forever. See the module remark for why
 * this is a poll rather than a stream.
 *
 * @param enabled - Whether to read at all.
 */
export function useLiveElicitations(enabled = true): LiveElicitations {
  const query = useLiveApiQuery(elicitationsDef(), enabled ? ELICITATION_LIVE_INTERVAL_MS : 0);
  const items = query.data?.items ?? [];
  return {
    pending: items.filter((item) => item.status === 'pending'),
    // Most recently settled first, so the question you just answered is the one still on screen —
    // "the card collapses to a read-only record" only holds if the record is where the card was.
    settled: items
      .filter((item) => item.status !== 'pending')
      .sort((a, b) => (b.settledAt ?? '').localeCompare(a.settledAt ?? '')),
    loading: query.isPending,
    failed: query.isError,
  };
}
