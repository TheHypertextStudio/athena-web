/** Durable provider-neutral projection of Athena session activity. */
import { and, asc, eq, exists, gt, isNull, lte, ne, or } from 'drizzle-orm';

import {
  actor,
  agentSessionExternalLink,
  db,
  integration,
  notification,
  sessionActivity,
} from '@docket/db';
import {
  agentSurfaceFor,
  isAgentSurfaceProvider,
  projectAgentSurface,
  sessionForAgentSurface,
  type AgentSurfaceProvider,
  type CanonicalAgentActivity,
  type ExternalRef,
  type SurfaceTypes,
} from '@docket/integrations';

import { signExternalAgentControl } from './external-agent-control-token';
import {
  isExternalAgentInstallationError,
  publishExternalAgentOutput,
} from './external-agent-publisher';
import { webAppOrigin } from './github-app';

type ActivityRow = typeof sessionActivity.$inferSelect;
type LinkRow = typeof agentSessionExternalLink.$inferSelect;

/** One type-correlated provider publication request. */
type ExternalAgentPublishRequestFor<P extends AgentSurfaceProvider> = {
  readonly provider: P;
  readonly organizationId: string;
  readonly session: SurfaceTypes<P>['sessionRef'];
} & (
  | { readonly kind: 'prepare_session'; readonly externalUrl: string }
  | { readonly kind: 'activity'; readonly output: SurfaceTypes<P>['outbound'] }
);

/** One publication request whose provider discriminant retains its native session/output types. */
export type ExternalAgentPublishRequest<P extends AgentSurfaceProvider = AgentSurfaceProvider> =
  P extends AgentSurfaceProvider ? ExternalAgentPublishRequestFor<P> : never;

/** Provider publication boundary used by the durable relay. */
export type ExternalAgentPublisher = (request: ExternalAgentPublishRequest) => Promise<ExternalRef>;

/** Injectable outbound relay dependencies. */
export interface ExternalAgentRelayDependencies {
  readonly publish: ExternalAgentPublisher;
}

function provider(value: string): AgentSurfaceProvider {
  if (isAgentSurfaceProvider(value)) return value;
  throw new Error('External agent link has an unsupported provider.');
}

function projectionContext(link: LinkRow) {
  return {
    externalWorkspaceId: link.externalWorkspaceId,
    externalSessionId: link.externalSessionId,
    ...(link.externalWorkItemId ? { externalWorkItemId: link.externalWorkItemId } : {}),
  };
}

/**
 * The external actor an elicitation is asking to authenticate, when it is asking that.
 *
 * @param row - The session activity row.
 * @returns The external actor id, or `null` when this row is not an authentication elicitation.
 */
function authenticationActorIdOf(row: ActivityRow): string | null {
  if (row.type !== 'elicitation') return null;
  const externalControl = row.body['externalAgentControl'];
  if (typeof externalControl !== 'object' || externalControl === null) return null;
  if (Reflect.get(externalControl, 'type') !== 'authentication') return null;
  const actorId: unknown = Reflect.get(externalControl, 'externalActorId');
  return typeof actorId === 'string' ? actorId : null;
}

/**
 * Mint the Docket-signed control an external surface renders alongside this activity.
 *
 * @param row - The session activity row.
 * @param link - The external session link the activity is relayed through.
 * @param externalProvider - The surface the control is addressed to.
 * @returns The control, or `undefined` when the activity needs none.
 */
function activityControl(
  row: ActivityRow,
  link: LinkRow,
  externalProvider: AgentSurfaceProvider,
): CanonicalAgentActivity['control'] {
  if (row.type === 'action' && row.approvalStatus === 'proposed') {
    const base = {
      provider: externalProvider,
      organizationId: link.organizationId,
      sessionId: link.sessionId,
      activityId: row.id,
    } as const;
    return {
      type: 'approval',
      activityId: row.id,
      approveToken: signExternalAgentControl({ kind: 'approval', ...base, decision: 'approve' }),
      rejectToken: signExternalAgentControl({ kind: 'approval', ...base, decision: 'reject' }),
    };
  }
  const authenticationActorId = authenticationActorIdOf(row);
  if (authenticationActorId === null) return undefined;
  const token = signExternalAgentControl({
    kind: 'authentication',
    provider: externalProvider,
    organizationId: link.organizationId,
    sessionId: link.sessionId,
    externalActorId: authenticationActorId,
  });
  return {
    type: 'authentication',
    url: `${webAppOrigin()}/external-agent/connect?${new URLSearchParams({ token }).toString()}`,
    externalActorId: authenticationActorId,
  };
}

function canonicalActivity(row: ActivityRow, link: LinkRow): CanonicalAgentActivity {
  const externalProvider = provider(link.provider);
  const control = activityControl(row, link, externalProvider);
  return {
    id: row.id,
    type: row.type,
    body: {
      ...(typeof row.body.text === 'string' ? { text: row.body.text } : {}),
      ...(row.body.action
        ? {
            action: {
              summary: row.body.action.summary,
              ...(row.body.action.result
                ? {
                    result: {
                      content: row.body.action.result.content,
                      isError: row.body.action.result.isError,
                    },
                  }
                : {}),
            },
          }
        : {}),
    },
    approvalStatus: row.approvalStatus,
    ...(control ? { control } : {}),
    ephemeral: row.type === 'thought' || row.type === 'action',
    updatedAt: row.updatedAt,
  };
}

function shouldSkip(row: ActivityRow): boolean {
  return row.type === 'response' && row.body.author === 'user';
}

async function publishActivity(
  publisher: ExternalAgentPublisher,
  link: LinkRow,
  activity: CanonicalAgentActivity,
): Promise<ExternalRef> {
  const projection = projectAgentSurface(link.provider, activity, projectionContext(link));
  if (!projection) throw new Error('External agent link has an unsupported provider.');
  return publisher({
    ...projection,
    kind: 'activity',
    organizationId: link.organizationId,
  });
}

function retryDelay(attempt: number): number {
  return Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempt - 1));
}

async function markInstallationUnavailable(link: LinkRow): Promise<void> {
  const adapter = agentSurfaceFor(provider(link.provider));
  const name = adapter.routing.displayName;
  const message = `The ${name} connection must be reconnected.`;
  const transitioned = await db
    .update(agentSessionExternalLink)
    .set({
      relayStatus: 'errored',
      nextRelayAt: null,
      lastRelayError: message,
    })
    .where(
      and(
        eq(agentSessionExternalLink.sessionId, link.sessionId),
        ne(agentSessionExternalLink.relayStatus, 'errored'),
      ),
    )
    .returning({ sessionId: agentSessionExternalLink.sessionId });
  if (!transitioned[0]) return;
  const [installed] = await db
    .update(integration)
    .set({ status: 'error', lastError: message, lastErrorAt: new Date() })
    .where(
      and(
        eq(integration.organizationId, link.organizationId),
        eq(integration.provider, adapter.routing.inboxProvider),
        or(
          ne(integration.status, 'error'),
          isNull(integration.lastError),
          ne(integration.lastError, message),
        ),
      ),
    )
    .returning({ createdBy: integration.createdBy });
  if (!installed?.createdBy) return;
  const [owner] = await db
    .select({ userId: actor.userId })
    .from(actor)
    .where(eq(actor.id, installed.createdBy))
    .limit(1);
  if (!owner?.userId) return;
  await db.insert(notification).values({
    userId: owner.userId,
    organizationId: link.organizationId,
    type: 'connector_needs_reauth',
    body: {
      title: `Reconnect ${name}`,
      summary: `Reconnect ${name} so Athena can continue replying in ${adapter.routing.destinationName}.`,
      url: `/orgs/${link.organizationId}/settings/connections`,
    },
  });
}

async function prepareExternalSession(
  publisher: ExternalAgentPublisher,
  link: LinkRow,
): Promise<void> {
  const externalUrl = `${webAppOrigin()}/orgs/${link.organizationId}/sessions/${link.sessionId}`;
  const projection = sessionForAgentSurface(link.provider, projectionContext(link));
  if (!projection) throw new Error('External agent link has an unsupported provider.');
  await publisher({
    ...projection,
    kind: 'prepare_session',
    organizationId: link.organizationId,
    externalUrl,
  });
}

/** How far a relay has got, carried across the retry write. */
interface RelayWatermark {
  readonly id: string | null;
  readonly updatedAt: Date | null;
}

/**
 * Record a failed relay attempt so the sweep retries it after a backoff.
 *
 * @param link - The external session link.
 * @param now - The clock.
 * @param message - The application-owned reason to store.
 * @param watermark - How far the relay got before failing, so the retry resumes there.
 */
async function recordRelayFailure(
  link: LinkRow,
  now: Date,
  message: string,
  watermark?: RelayWatermark,
): Promise<void> {
  const attempts = link.relayAttempts + 1;
  await db
    .update(agentSessionExternalLink)
    .set({
      ...(watermark
        ? { lastRelayedActivityId: watermark.id, lastRelayedActivityUpdatedAt: watermark.updatedAt }
        : {}),
      relayStatus: 'retrying',
      relayAttempts: attempts,
      nextRelayAt: new Date(now.getTime() + retryDelay(attempts)),
      lastRelayError: message,
    })
    .where(eq(agentSessionExternalLink.sessionId, link.sessionId));
}

/**
 * Acknowledge the external session before any activity is relayed into it.
 *
 * @param link - The external session link.
 * @param now - The clock.
 * @param dependencies - The publication boundary.
 * @returns `true` when the relay may continue, `false` when it must wait for a retry.
 */
async function ensureSessionPrepared(
  link: LinkRow,
  now: Date,
  dependencies: ExternalAgentRelayDependencies,
): Promise<boolean> {
  if (link.relayStatus !== 'pending' || link.lastRelayedActivityUpdatedAt) return true;
  try {
    await prepareExternalSession(dependencies.publish, link);
    return true;
  } catch (error) {
    if (isExternalAgentInstallationError(error)) {
      await markInstallationUnavailable(link);
      return false;
    }
    await recordRelayFailure(link, now, 'External provider session acknowledgement failed.');
    return false;
  }
}

/**
 * Read the activity rows this link has not relayed yet, oldest first.
 *
 * @param link - The external session link, whose watermark is the cursor.
 * @returns The due rows in relay order.
 */
async function dueActivityRows(link: LinkRow) {
  const cursor = link.lastRelayedActivityUpdatedAt
    ? or(
        gt(sessionActivity.updatedAt, link.lastRelayedActivityUpdatedAt),
        and(
          eq(sessionActivity.updatedAt, link.lastRelayedActivityUpdatedAt),
          gt(sessionActivity.id, link.lastRelayedActivityId ?? ''),
        ),
      )
    : undefined;
  return db
    .select()
    .from(sessionActivity)
    .where(and(eq(sessionActivity.sessionId, link.sessionId), cursor))
    .orderBy(asc(sessionActivity.updatedAt), asc(sessionActivity.id));
}

/** Relay all due activity for one linked external session in cursor order. */
export async function relayExternalAgentActivity(
  sessionId: string,
  now: Date,
  dependencies: ExternalAgentRelayDependencies = { publish: publishExternalAgentOutput },
): Promise<void> {
  const [link] = await db
    .select()
    .from(agentSessionExternalLink)
    .where(eq(agentSessionExternalLink.sessionId, sessionId))
    .limit(1);
  if (!link || link.relayStatus === 'errored' || (link.nextRelayAt && link.nextRelayAt > now)) {
    return;
  }
  if (!(await ensureSessionPrepared(link, now, dependencies))) return;

  let watermark: RelayWatermark = {
    id: link.lastRelayedActivityId,
    updatedAt: link.lastRelayedActivityUpdatedAt,
  };
  for (const row of await dueActivityRows(link)) {
    if (!shouldSkip(row)) {
      try {
        await publishActivity(dependencies.publish, link, canonicalActivity(row, link));
      } catch (error) {
        if (isExternalAgentInstallationError(error)) {
          await markInstallationUnavailable(link);
          return;
        }
        await recordRelayFailure(link, now, 'External provider delivery failed.', watermark);
        return;
      }
    }
    watermark = { id: row.id, updatedAt: row.updatedAt };
  }
  await db
    .update(agentSessionExternalLink)
    .set({
      lastRelayedActivityId: watermark.id,
      lastRelayedActivityUpdatedAt: watermark.updatedAt,
      relayStatus: 'ready',
      relayAttempts: 0,
      nextRelayAt: null,
      lastRelayError: null,
    })
    .where(eq(agentSessionExternalLink.sessionId, sessionId));
}

/** Result of one provider-neutral relay sweep. */
export interface ExternalAgentRelaySweepResult {
  readonly found: number;
  readonly processed: number;
}

/** Sweep linked sessions independently of whether any model run is due. */
export async function sweepExternalAgentRelays(
  now: Date,
  dependencies: ExternalAgentRelayDependencies = { publish: publishExternalAgentOutput },
): Promise<ExternalAgentRelaySweepResult> {
  const laggedActivity = db
    .select({ id: sessionActivity.id })
    .from(sessionActivity)
    .where(
      and(
        eq(sessionActivity.sessionId, agentSessionExternalLink.sessionId),
        or(
          isNull(agentSessionExternalLink.lastRelayedActivityUpdatedAt),
          gt(sessionActivity.updatedAt, agentSessionExternalLink.lastRelayedActivityUpdatedAt),
          and(
            eq(sessionActivity.updatedAt, agentSessionExternalLink.lastRelayedActivityUpdatedAt),
            gt(sessionActivity.id, agentSessionExternalLink.lastRelayedActivityId),
          ),
        ),
      ),
    )
    .limit(1);
  const links = await db
    .select({ sessionId: agentSessionExternalLink.sessionId })
    .from(agentSessionExternalLink)
    .where(
      or(
        eq(agentSessionExternalLink.relayStatus, 'pending'),
        and(
          eq(agentSessionExternalLink.relayStatus, 'retrying'),
          lte(agentSessionExternalLink.nextRelayAt, now),
        ),
        and(eq(agentSessionExternalLink.relayStatus, 'ready'), exists(laggedActivity)),
      ),
    )
    .orderBy(asc(agentSessionExternalLink.updatedAt))
    .limit(100);
  let processed = 0;
  for (const link of links) {
    await relayExternalAgentActivity(link.sessionId, now, dependencies);
    processed += 1;
  }
  return { found: links.length, processed };
}
