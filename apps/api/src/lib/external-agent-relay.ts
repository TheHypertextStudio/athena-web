/** Durable provider-neutral projection of Athena session activity. */
import { and, asc, eq, gt, or } from 'drizzle-orm';

import { agentSessionExternalLink, db, sessionActivity } from '@docket/db';
import {
  agentSurfaceFor,
  type AgentSurfaceProvider,
  type CanonicalAgentActivity,
  type ExternalRef,
  type ExternalSessionProjectionContext,
  type SurfaceTypes,
} from '@docket/integrations';

import { signExternalAgentControl } from './external-agent-control-token';

type ActivityRow = typeof sessionActivity.$inferSelect;
type LinkRow = typeof agentSessionExternalLink.$inferSelect;

/** Provider publication boundary used by the durable relay. */
export type ExternalAgentPublisher = <P extends AgentSurfaceProvider>(
  provider: P,
  session: SurfaceTypes<P>['sessionRef'],
  output: SurfaceTypes<P>['outbound'],
) => Promise<ExternalRef>;

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
      return publisher(
        'linear',
        { id: link.externalSessionId },
        agentSurfaceFor('linear').render(activity, context),
      );
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
      return publisher(
        'slack',
        { id: link.externalSessionId, channelId, threadTs },
        agentSurfaceFor('slack').render(activity, context),
      );
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
      return publisher(
        'github',
        {
          id: link.externalSessionId,
          repository,
          issueNumber,
          ...(pullRequestHeadSha ? { pullRequestHeadSha } : {}),
        },
        agentSurfaceFor('github').render(activity, context),
      );
    }
    case 'jira_a2a': {
      const context: ExternalSessionProjectionContext<'jira_a2a'> = {
        provider: 'jira_a2a',
        externalWorkspaceId: link.externalWorkspaceId,
        externalSessionId: link.externalSessionId,
        ...(link.externalWorkItemId ? { externalWorkItemId: link.externalWorkItemId } : {}),
      };
      return publisher(
        'jira_a2a',
        { id: link.externalSessionId },
        agentSurfaceFor('jira_a2a').render(activity, context),
      );
    }
  }
}

function retryDelay(attempt: number): number {
  return Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempt - 1));
}

/** Relay all due activity for one linked external session in cursor order. */
export async function relayExternalAgentActivity(
  sessionId: string,
  now: Date,
  dependencies: ExternalAgentRelayDependencies,
): Promise<void> {
  const [link] = await db
    .select()
    .from(agentSessionExternalLink)
    .where(eq(agentSessionExternalLink.sessionId, sessionId))
    .limit(1);
  if (!link || (link.nextRelayAt && link.nextRelayAt > now)) return;
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
      } catch {
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
