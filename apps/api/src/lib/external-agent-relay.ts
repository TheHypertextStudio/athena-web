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
  type AgentSurfaceProvider,
  type CanonicalAgentActivity,
  type ExternalRef,
  type ExternalSessionProjectionContext,
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
export type ExternalAgentPublishRequest = {
  [P in AgentSurfaceProvider]: {
    readonly provider: P;
    readonly organizationId: string;
    readonly session: SurfaceTypes<P>['sessionRef'];
  } & (
    | { readonly kind: 'prepare_session'; readonly externalUrl: string }
    | { readonly kind: 'activity'; readonly output: SurfaceTypes<P>['outbound'] }
  );
}[AgentSurfaceProvider];

/** Provider publication boundary used by the durable relay. */
export type ExternalAgentPublisher = (request: ExternalAgentPublishRequest) => Promise<ExternalRef>;

/** Injectable outbound relay dependencies. */
export interface ExternalAgentRelayDependencies {
  readonly publish: ExternalAgentPublisher;
}

function provider(value: string): AgentSurfaceProvider {
  if (value === 'linear' || value === 'slack' || value === 'github' || value === 'jira_a2a') {
    return value;
  }
  throw new Error('External agent link has an unsupported provider.');
}

function canonicalActivity(row: ActivityRow, link: LinkRow): CanonicalAgentActivity {
  const externalProvider = provider(link.provider);
  const externalControl = row.body['externalAgentControl'];
  const authenticationActorId =
    row.type === 'elicitation' &&
    typeof externalControl === 'object' &&
    externalControl !== null &&
    Reflect.get(externalControl, 'type') === 'authentication' &&
    typeof Reflect.get(externalControl, 'externalActorId') === 'string'
      ? (Reflect.get(externalControl, 'externalActorId') as string)
      : null;
  const control =
    row.type === 'action' && row.approvalStatus === 'proposed'
      ? {
          type: 'approval' as const,
          activityId: row.id,
          approveToken: signExternalAgentControl({
            kind: 'approval',
            provider: externalProvider,
            sessionId: link.sessionId,
            activityId: row.id,
            decision: 'approve',
          }),
          rejectToken: signExternalAgentControl({
            kind: 'approval',
            provider: externalProvider,
            sessionId: link.sessionId,
            activityId: row.id,
            decision: 'reject',
          }),
        }
      : authenticationActorId
        ? {
            type: 'authentication' as const,
            url: `${webAppOrigin()}/external-agent/connect?${new URLSearchParams({
              token: signExternalAgentControl({
                kind: 'authentication',
                provider: externalProvider,
                sessionId: link.sessionId,
                externalActorId: authenticationActorId,
              }),
            }).toString()}`,
            externalActorId: authenticationActorId,
          }
        : undefined;
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
  const externalProvider = provider(link.provider);
  switch (externalProvider) {
    case 'linear': {
      const context: ExternalSessionProjectionContext<'linear'> = {
        provider: 'linear',
        externalWorkspaceId: link.externalWorkspaceId,
        externalSessionId: link.externalSessionId,
        ...(link.externalWorkItemId ? { externalWorkItemId: link.externalWorkItemId } : {}),
      };
      return publisher({
        provider: 'linear',
        kind: 'activity',
        organizationId: link.organizationId,
        session: { id: link.externalSessionId },
        output: agentSurfaceFor('linear').render(activity, context),
      });
    }
    case 'slack': {
      const [channelId, threadTs] = link.externalSessionId.split(':', 2);
      if (!channelId || !threadTs) throw new Error('Slack external session id is malformed.');
      const context: ExternalSessionProjectionContext<'slack'> = {
        provider: 'slack',
        externalWorkspaceId: link.externalWorkspaceId,
        externalSessionId: link.externalSessionId,
        ...(link.externalWorkItemId ? { externalWorkItemId: link.externalWorkItemId } : {}),
      };
      return publisher({
        provider: 'slack',
        kind: 'activity',
        organizationId: link.organizationId,
        session: { id: link.externalSessionId, channelId, threadTs },
        output: agentSurfaceFor('slack').render(activity, context),
      });
    }
    case 'github': {
      const separator = link.externalSessionId.lastIndexOf('#');
      const repository = link.externalSessionId.slice(0, separator);
      const issueNumber = Number(link.externalSessionId.slice(separator + 1));
      if (separator < 1 || !Number.isInteger(issueNumber)) {
        throw new Error('GitHub external session id is malformed.');
      }
      const pullRequestHeadSha = link.externalWorkItemId?.startsWith('pull:')
        ? link.externalWorkItemId.split(':')[2]
        : undefined;
      const context: ExternalSessionProjectionContext<'github'> = {
        provider: 'github',
        externalWorkspaceId: link.externalWorkspaceId,
        externalSessionId: link.externalSessionId,
        ...(link.externalWorkItemId ? { externalWorkItemId: link.externalWorkItemId } : {}),
      };
      return publisher({
        provider: 'github',
        kind: 'activity',
        organizationId: link.organizationId,
        session: {
          id: link.externalSessionId,
          repository,
          issueNumber,
          ...(pullRequestHeadSha ? { pullRequestHeadSha } : {}),
        },
        output: agentSurfaceFor('github').render(activity, context),
      });
    }
    case 'jira_a2a': {
      const context: ExternalSessionProjectionContext<'jira_a2a'> = {
        provider: 'jira_a2a',
        externalWorkspaceId: link.externalWorkspaceId,
        externalSessionId: link.externalSessionId,
        ...(link.externalWorkItemId ? { externalWorkItemId: link.externalWorkItemId } : {}),
      };
      return publisher({
        provider: 'jira_a2a',
        kind: 'activity',
        organizationId: link.organizationId,
        session: { id: link.externalSessionId },
        output: agentSurfaceFor('jira_a2a').render(activity, context),
      });
    }
  }
}

function retryDelay(attempt: number): number {
  return Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempt - 1));
}

async function markInstallationUnavailable(link: LinkRow): Promise<void> {
  const message = 'The Linear Agent connection must be reconnected.';
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
        eq(integration.provider, 'linear_agent'),
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
      title: 'Reconnect Linear Agent',
      summary: 'Reconnect Linear Agent so Athena can continue replying in Linear.',
      url: `/orgs/${link.organizationId}/settings/connections`,
    },
  });
}

async function prepareExternalSession(
  publisher: ExternalAgentPublisher,
  link: LinkRow,
): Promise<void> {
  const externalUrl = `${webAppOrigin()}/orgs/${link.organizationId}/sessions/${link.sessionId}`;
  const externalProvider = provider(link.provider);
  switch (externalProvider) {
    case 'linear':
      await publisher({
        provider: 'linear',
        kind: 'prepare_session',
        organizationId: link.organizationId,
        session: { id: link.externalSessionId },
        externalUrl,
      });
      return;
    case 'slack': {
      const [channelId, threadTs] = link.externalSessionId.split(':', 2);
      if (!channelId || !threadTs) throw new Error('Slack external session id is malformed.');
      await publisher({
        provider: 'slack',
        kind: 'prepare_session',
        organizationId: link.organizationId,
        session: { id: link.externalSessionId, channelId, threadTs },
        externalUrl,
      });
      return;
    }
    case 'github': {
      const separator = link.externalSessionId.lastIndexOf('#');
      const repository = link.externalSessionId.slice(0, separator);
      const issueNumber = Number(link.externalSessionId.slice(separator + 1));
      if (separator < 1 || !Number.isInteger(issueNumber)) {
        throw new Error('GitHub external session id is malformed.');
      }
      await publisher({
        provider: 'github',
        kind: 'prepare_session',
        organizationId: link.organizationId,
        session: { id: link.externalSessionId, repository, issueNumber },
        externalUrl,
      });
      return;
    }
    case 'jira_a2a':
      await publisher({
        provider: 'jira_a2a',
        kind: 'prepare_session',
        organizationId: link.organizationId,
        session: { id: link.externalSessionId },
        externalUrl,
      });
  }
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
  if (link.relayStatus === 'pending' && !link.lastRelayedActivityUpdatedAt) {
    try {
      await prepareExternalSession(dependencies.publish, link);
    } catch (error) {
      if (isExternalAgentInstallationError(error)) {
        await markInstallationUnavailable(link);
        return;
      }
      const attempts = link.relayAttempts + 1;
      await db
        .update(agentSessionExternalLink)
        .set({
          relayStatus: 'retrying',
          relayAttempts: attempts,
          nextRelayAt: new Date(now.getTime() + retryDelay(attempts)),
          lastRelayError: 'External provider session acknowledgement failed.',
        })
        .where(eq(agentSessionExternalLink.sessionId, sessionId));
      return;
    }
  }
  const cursor = link.lastRelayedActivityUpdatedAt
    ? or(
        gt(sessionActivity.updatedAt, link.lastRelayedActivityUpdatedAt),
        and(
          eq(sessionActivity.updatedAt, link.lastRelayedActivityUpdatedAt),
          gt(sessionActivity.id, link.lastRelayedActivityId ?? ''),
        ),
      )
    : undefined;
  const rows = await db
    .select()
    .from(sessionActivity)
    .where(and(eq(sessionActivity.sessionId, sessionId), cursor))
    .orderBy(asc(sessionActivity.updatedAt), asc(sessionActivity.id));
  let watermarkId = link.lastRelayedActivityId;
  let watermarkUpdatedAt = link.lastRelayedActivityUpdatedAt;
  for (const row of rows) {
    if (!shouldSkip(row)) {
      try {
        await publishActivity(dependencies.publish, link, canonicalActivity(row, link));
      } catch (error) {
        if (isExternalAgentInstallationError(error)) {
          await markInstallationUnavailable(link);
          return;
        }
        const attempts = link.relayAttempts + 1;
        await db
          .update(agentSessionExternalLink)
          .set({
            lastRelayedActivityId: watermarkId,
            lastRelayedActivityUpdatedAt: watermarkUpdatedAt,
            relayStatus: 'retrying',
            relayAttempts: attempts,
            nextRelayAt: new Date(now.getTime() + retryDelay(attempts)),
            lastRelayError: 'External provider delivery failed.',
          })
          .where(eq(agentSessionExternalLink.sessionId, sessionId));
        return;
      }
    }
    watermarkId = row.id;
    watermarkUpdatedAt = row.updatedAt;
  }
  await db
    .update(agentSessionExternalLink)
    .set({
      lastRelayedActivityId: watermarkId,
      lastRelayedActivityUpdatedAt: watermarkUpdatedAt,
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
