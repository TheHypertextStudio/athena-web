/**
 * `@docket/api` — the caller-owned elicitation surface, mounted at `/v1/me/elicitations`.
 *
 * @remarks
 * Three things this router exists to make true, all of which the free-text reply route it replaces
 * could not:
 *
 * 1. **Answers are validated server-side.** A submission that does not satisfy the declared spec
 *    comes back `422` with per-field reasons *and the still-open question*, so the client re-renders
 *    the same form with the person's other fields intact. Nothing is written.
 * 2. **Questions are live when the person is there.** The `presence` route records that the caller
 *    has the surface open and focused, which is what decides whether a newly raised question is
 *    answered in place or pushed to their device. The surface itself re-reads this router on a
 *    1.5s live poll rather than holding a stream open — see `elicitation-data.ts` for why a
 *    persistent `EventSource` was rejected.
 * 3. **Notifications are actionable.** The web-push router registers a browser subscription as a
 *    `push_token` contact point and hands back the VAPID public key, which is what lets an
 *    elicitation's own options arrive as buttons on the notification rather than as "open the app".
 */
import { contactPoint, db } from '@docket/db';
import {
  AthenaPresenceBody,
  AthenaPresenceOut,
  ElicitationAnswerBody,
  ElicitationListOut,
  ElicitationOut,
  ElicitationRejectionOut,
  ElicitationSweepOut,
} from '@docket/types';
import { WebPushSubscription } from '@docket/notifications/webpush';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';

import { asynchronousRunnerEnabled, wakeWaitingAthenaGeneration } from '../agent/async-runner';
import { resumeSessionExecution } from '../agent/loop';
import type { AppEnv } from '../context';
import { env } from '../env';
import { AuthError, NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';
import {
  ATHENA_PRESENCE_WINDOW_MS,
  answerElicitation,
  listElicitationsFor,
  loadElicitation,
  readAthenaPresence,
  recordAthenaPresence,
  sweepElicitations,
  toElicitationOut,
} from '../services/elicitation-service';
import { vapidPublicKey } from '../services/elicitation-notify';
import { raiseSampleElicitations } from '../services/elicitation-samples';

/** Route params addressing one question. */
const elicitationParam = z.object({ id: z.string() });

/** Return the request-authenticated caller; a body never participates in identity. */
function requestOwner(c: Context<AppEnv>): string {
  const userId = c.get('session')?.user.id;
  if (!userId) throw new AuthError();
  return userId;
}

/** Present the caller's presence state. */
function presenceOut(live: boolean, lastSeenAt: Date | null): AthenaPresenceOut {
  return {
    live,
    lastSeenAt: lastSeenAt ? lastSeenAt.toISOString() : null,
    windowMs: ATHENA_PRESENCE_WINDOW_MS,
  };
}

/** The caller-owned elicitation router. */
const elicitations = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Athena',
      summary: 'List the questions Athena is waiting on',
      response: ElicitationListOut,
      description:
        'Every elicitation addressed to the caller, pending ones first and oldest deadline first, each with the task it exists to implement.',
    }),
    async (c) => {
      const owner = requestOwner(c);
      const rows = await listElicitationsFor(owner);
      return ok(c, ElicitationListOut, { items: rows.map(toElicitationOut) });
    },
  )
  .get(
    '/presence',
    apiDoc({
      tag: 'Athena',
      summary: 'Read whether the caller is being treated as present',
      response: AthenaPresenceOut,
      description:
        'Whether a question raised right now would be considered live for the caller, and when they were last seen watching.',
    }),
    async (c) => {
      const owner = requestOwner(c);
      const presence = await readAthenaPresence(owner);
      return ok(c, AthenaPresenceOut, presenceOut(presence.live, presence.lastSeenAt));
    },
  )
  .post(
    '/presence',
    apiDoc({
      tag: 'Athena',
      summary: 'Record that the caller is watching Athena',
      response: AthenaPresenceOut,
      description:
        'A heartbeat from an open, focused Athena surface. Questions raised while it is fresh are treated as live and answered in place; questions raised after it lapses are pushed instead.',
    }),
    zJson(AthenaPresenceBody),
    async (c) => {
      const owner = requestOwner(c);
      const now = new Date();
      await recordAthenaPresence(owner, c.req.valid('json').focused, now);
      const presence = await readAthenaPresence(owner, now);
      return ok(c, AthenaPresenceOut, presenceOut(presence.live, presence.lastSeenAt));
    },
  )
  .get(
    '/:id',
    apiDoc({
      tag: 'Athena',
      summary: 'Read one question',
      response: ElicitationOut,
      description: 'One elicitation addressed to the caller, with the task it exists to implement.',
    }),
    zParam(elicitationParam),
    async (c) => {
      const owner = requestOwner(c);
      const entry = await loadElicitation(c.req.valid('param').id, owner);
      return ok(c, ElicitationOut, toElicitationOut(entry));
    },
  )
  .post(
    '/:id/answer',
    apiDoc({
      tag: 'Athena',
      summary: 'Answer one question',
      response: ElicitationOut,
      description:
        'Validate the submitted value against the question’s declared schema, record it as typed data, hand it to the waiting agent, and resume the work. An invalid answer is refused with field-level reasons and the question stays open.',
    }),
    zParam(elicitationParam),
    zJson(ElicitationAnswerBody),
    async (c) => {
      const owner = requestOwner(c);
      const { id } = c.req.valid('param');
      const entry = await loadElicitation(id, owner);
      const result = await answerElicitation({
        elicitationId: id,
        userId: owner,
        value: c.req.valid('json').value,
      });
      if (!result.ok) {
        return c.json(
          ElicitationRejectionOut.parse({
            errors: result.errors,
            elicitation: toElicitationOut(entry),
          }),
          422,
        );
      }
      await resumeAfterAnswer(result.elicitation.sessionId, result.elicitation.organizationId);
      const settled = await loadElicitation(id, owner);
      return ok(c, ElicitationOut, toElicitationOut(settled));
    },
  )
  .post(
    '/samples',
    apiDoc({
      tag: 'Athena',
      summary: 'Raise one sample question of each response type (local development only)',
      response: ElicitationListOut,
      description:
        'Raises one elicitation of every response type against the caller’s own conversation so the surface can be built, reviewed and screenshotted without a live model. Refused outside a local development stack.',
    }),
    async (c) => {
      const owner = requestOwner(c);
      if (env.APP_MODE !== 'local') throw new NotFoundError('Not found');
      const raised = await raiseSampleElicitations(owner);
      return ok(c, ElicitationListOut, { items: raised.map(toElicitationOut) });
    },
  )
  .post(
    '/sweep',
    apiDoc({
      tag: 'Athena',
      summary: 'Settle every question past its deadline',
      response: ElicitationSweepOut,
      description:
        'Runs the deadline sweep for the caller’s own questions and the rest of the queue: a question with a declared, defensible default is answered by Athena with her reasoning recorded; every other overdue question is parked with nothing mutated.',
    }),
    async (c) => {
      requestOwner(c);
      const result = await sweepElicitations();
      return ok(c, ElicitationSweepOut, result);
    },
  );

/**
 * Resume the session that was blocked on a question.
 *
 * @remarks
 * Mirrors the free-text reply path exactly: under the asynchronous runner the wake is queued and
 * the caller gets the settled question immediately; otherwise execution is driven inline. Failures
 * are swallowed on purpose — the answer is already durably recorded, and a resume that could not
 * start is recovered by the lease sweeper. Reporting it as a failed answer would make the person
 * answer twice.
 */
async function resumeAfterAnswer(sessionId: string, organizationId: string | null): Promise<void> {
  try {
    if (asynchronousRunnerEnabled()) {
      await wakeWaitingAthenaGeneration(sessionId);
      return;
    }
    await resumeSessionExecution(organizationId ?? '', sessionId);
  } catch {
    // Deliberately ignored; see the remark above.
  }
}

/** The VAPID public key the browser subscribes with, or null when push is not configured. */
const WebPushConfigOut = z
  .object({
    /** base64url uncompressed P-256 point, or null when the deployment has no VAPID identity. */
    publicKey: z.string().nullable(),
  })
  .meta({
    id: 'WebPushConfig',
    description: 'The application server key a browser needs to subscribe to push.',
  });

/** Whether the caller currently has a usable push subscription. */
const WebPushSubscriptionOut = z.object({ subscribed: z.boolean() }).meta({
  id: 'WebPushSubscriptionState',
  description: 'Whether the caller has a registered browser push subscription.',
});

/**
 * The browser push-subscription router, mounted at `/v1/me/web-push`.
 *
 * @remarks
 * A subscription is stored as an existing `push_token` contact point rather than in a table of its
 * own: it *is* a user-owned notification destination, and reusing the contact-point record means
 * the existing verification, disable-on-bounce and preference machinery already applies to it. The
 * endpoint is the normalized value, which is also the browser's own uniqueness key.
 */
const webPush = new Hono<AppEnv>()
  .get(
    '/config',
    apiDoc({
      tag: 'Athena',
      summary: 'Read the browser push application server key',
      response: WebPushConfigOut,
      description:
        'The VAPID public key a browser must pass to PushManager.subscribe. Null when this deployment has no push identity configured, which is how the client knows to hide the enable control instead of offering one that cannot work.',
    }),
    (c) => ok(c, WebPushConfigOut, { publicKey: vapidPublicKey() }),
  )
  .get(
    '/subscription',
    apiDoc({
      tag: 'Athena',
      summary: 'Read whether the caller has a push subscription',
      response: WebPushSubscriptionOut,
      description: 'Whether any active browser push subscription is registered for the caller.',
    }),
    async (c) => {
      const owner = requestOwner(c);
      const rows = await db
        .select({ id: contactPoint.id })
        .from(contactPoint)
        .where(
          and(
            eq(contactPoint.userId, owner),
            eq(contactPoint.type, 'push_token'),
            eq(contactPoint.status, 'active'),
          ),
        )
        .limit(1);
      return ok(c, WebPushSubscriptionOut, { subscribed: rows.length > 0 });
    },
  )
  .post(
    '/subscription',
    apiDoc({
      tag: 'Athena',
      summary: 'Register a browser push subscription',
      response: WebPushSubscriptionOut,
      description:
        'Store the subscription a browser returned from PushManager.subscribe so time-sensitive questions can reach the caller with their own options as action buttons. Re-registering the same endpoint reactivates it rather than duplicating it.',
    }),
    zJson(WebPushSubscription),
    async (c) => {
      const owner = requestOwner(c);
      const subscription = c.req.valid('json');
      const now = new Date();
      await db
        .insert(contactPoint)
        .values({
          userId: owner,
          type: 'push_token',
          value: JSON.stringify(subscription),
          valueNormalized: subscription.endpoint,
          valueMasked: maskEndpoint(subscription.endpoint),
          // A subscription the browser just minted is already proof the person granted permission;
          // there is no second channel to verify it through.
          status: 'active',
          verifiedAt: now,
        })
        .onConflictDoUpdate({
          target: [contactPoint.userId, contactPoint.type, contactPoint.valueNormalized],
          set: {
            value: JSON.stringify(subscription),
            status: 'active',
            disabledAt: null,
            verifiedAt: now,
            updatedAt: now,
          },
        });
      return ok(c, WebPushSubscriptionOut, { subscribed: true });
    },
  )
  .delete(
    '/subscription',
    apiDoc({
      tag: 'Athena',
      summary: 'Remove the caller’s browser push subscriptions',
      response: WebPushSubscriptionOut,
      description:
        'Disable every registered browser push subscription for the caller. Used when the person turns notifications off, or when the browser reports the subscription has changed.',
    }),
    async (c) => {
      const owner = requestOwner(c);
      await db
        .update(contactPoint)
        .set({ status: 'disabled', disabledAt: new Date() })
        .where(and(eq(contactPoint.userId, owner), eq(contactPoint.type, 'push_token')));
      return ok(c, WebPushSubscriptionOut, { subscribed: false });
    },
  );

/** Show enough of a push endpoint to tell two browsers apart, and no more. */
function maskEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    return `${url.host}/…${endpoint.slice(-6)}`;
  } catch {
    /* v8 ignore next -- @preserve defensive: the schema already required a URL */
    return `…${endpoint.slice(-6)}`;
  }
}

/** The browser push-subscription router; mount at `/me/web-push`. */
export const webPushRoutes = webPush;

export default elicitations;
