import { createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import type { HttpClient } from './http';
import { defaultHttpClient } from './http';
import type {
  AgentSurfaceAdapter,
  CanonicalAgentControl,
  ExternalRef,
  SurfaceTypeFamily,
} from './agent-surface';
import { canonicalActivityText } from './agent-surface';

const githubWebhookSchema = z
  .object({
    action: z.string(),
    installation: z.object({ id: z.number() }),
    repository: z.object({ id: z.number(), full_name: z.string(), html_url: z.string() }),
    issue: z
      .object({
        id: z.number(),
        number: z.number(),
        title: z.string(),
        body: z.string().nullable().optional(),
        html_url: z.string(),
      })
      .optional(),
    pull_request: z
      .object({
        id: z.number(),
        number: z.number(),
        title: z.string(),
        body: z.string().nullable().optional(),
        html_url: z.string(),
        head: z.object({ sha: z.string() }).optional(),
      })
      .optional(),
    comment: z.object({ id: z.number(), body: z.string(), html_url: z.string() }).optional(),
    check_run: z
      .object({ id: z.number(), external_id: z.string().nullable().optional() })
      .optional(),
    requested_action: z.object({ identifier: z.string() }).optional(),
    sender: z.object({ id: z.number(), login: z.string() }),
  })
  .refine(
    (value) => Boolean(value.issue ?? value.pull_request ?? value.check_run),
    'A work item is required.',
  );

/** Verified GitHub App webhook. */
export type GitHubAgentWebhook = z.infer<typeof githubWebhookSchema>;

/** GitHub App verification configuration. */
export interface GitHubAgentVerification {
  readonly signingSecret: string;
}

/** One installed GitHub App. */
export interface GitHubAgentInstall extends GitHubAgentVerification {
  readonly installationId: string;
  readonly token: string;
  readonly commandName: string;
  readonly http?: HttpClient;
}

/** GitHub issue or pull-request discussion reference. */
export interface GitHubDiscussionRef extends ExternalRef {
  readonly repository: string;
  readonly issueNumber: number;
  readonly pullRequestHeadSha?: string;
}

/** Native GitHub comment or check-run projection. */
export type GitHubAgentOutput =
  | { readonly kind: 'comment'; readonly body: string }
  | {
      readonly kind: 'check_run';
      readonly name: string;
      readonly status: 'in_progress' | 'completed';
      readonly conclusion?: 'success' | 'failure' | 'neutral' | 'cancelled';
      readonly summary: string;
      readonly actions?: readonly {
        readonly label: string;
        readonly description: string;
        readonly identifier: string;
      }[];
    };

/** GitHub's external-agent wire family. */
export interface GitHubSurfaceTypes extends SurfaceTypeFamily<'github'> {
  readonly verification: GitHubAgentVerification;
  readonly install: GitHubAgentInstall;
  readonly webhook: GitHubAgentWebhook;
  readonly workspaceRef: ExternalRef;
  readonly sessionRef: GitHubDiscussionRef;
  readonly actorRef: ExternalRef;
  readonly nativeContext: { readonly repository: string; readonly issueNumber: number };
  readonly outbound: GitHubAgentOutput;
  readonly receipt: ExternalRef;
}

function safeEqual(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function githubFallbackBody(body: string, control: CanonicalAgentControl | undefined): string {
  if (!control) return body;
  if (control.type === 'approval') {
    return `${body}\n\nReply with one of these signed commands:\n\n- \`/athena approve ${control.approveToken}\`\n- \`/athena reject ${control.rejectToken}\``;
  }
  if (control.type === 'authentication') {
    return `${body}\n\n[Connect your Docket account](${control.url}) to continue.`;
  }
  return `${body}\n\nTo stop this run, reply with \`/athena stop ${control.stopToken}\`.`;
}

/** GitHub App agent adapter. */
export const githubAgentSurface: AgentSurfaceAdapter<'github', GitHubSurfaceTypes> = {
  provider: 'github',
  capabilities: {
    progress: 'check_run',
    approval: 'check_actions',
    authentication: 'plain_link',
    stop: 'reply',
    plans: false,
  },
  async verify(input, verification) {
    const signature = input.headers['x-hub-signature-256'];
    const deliveryId = input.headers['x-github-delivery'];
    const eventType = input.headers['x-github-event'];
    const expected = `sha256=${createHmac('sha256', verification.signingSecret).update(input.body).digest('hex')}`;
    if (!signature || !deliveryId || !eventType || !safeEqual(signature, expected)) {
      throw new Error('GitHub webhook signature or delivery metadata is invalid.');
    }
    return { deliveryId, eventType, payload: githubWebhookSchema.parse(JSON.parse(input.body)) };
  },
  route(input) {
    return { workspaceId: String(input.payload.installation.id) };
  },
  async normalize(input, install) {
    const payload = input.payload;
    const workItem = payload.pull_request ?? payload.issue;
    const issueNumber = workItem?.number;
    if (!workItem || issueNumber === undefined) return [];
    const externalSessionId = `${payload.repository.full_name}#${issueNumber}`;
    const actor = { externalId: String(payload.sender.id), displayName: payload.sender.login };
    if (input.eventType === 'check_run' && payload.requested_action) {
      const identifier = payload.requested_action.identifier;
      if (identifier.startsWith('stop:')) {
        return [
          {
            type: 'stop_requested',
            externalSessionId,
            externalActivityId: String(payload.check_run?.id ?? input.deliveryId),
            actor,
          },
        ];
      }
      return [
        {
          type: 'approval_selected',
          externalSessionId,
          externalActivityId: String(payload.check_run?.id ?? input.deliveryId),
          actor,
          choiceToken: identifier,
        },
      ];
    }
    const rawCommand = payload.comment?.body ?? workItem.body ?? '';
    const command = new RegExp(`(?:@|/)${install.commandName}\\b`, 'i');
    if (!command.test(rawCommand)) return [];
    const prompt = rawCommand.replace(command, '').trim();
    const activityId = String(payload.comment?.id ?? workItem.id);
    if (payload.comment && payload.action !== 'created') {
      return [
        {
          type: 'prompt_received',
          externalSessionId,
          externalActivityId: activityId,
          actor,
          body: prompt,
        },
      ];
    }
    return [
      {
        type: 'session_started',
        workspaceId: String(payload.installation.id),
        externalSessionId,
        actor,
        context: {
          prompt,
          guidance: [],
          workItem: {
            externalId: String(workItem.id),
            title: workItem.title,
            url: workItem.html_url,
          },
          references: [{ id: String(payload.repository.id), url: payload.repository.html_url }],
        },
        trigger: 'mention',
      },
    ];
  },
  render(activity, context) {
    const body = canonicalActivityText(activity);
    const control = activity.control;
    if (context.externalWorkItemId?.startsWith('pull:')) {
      return {
        kind: 'check_run',
        name: 'Athena',
        status:
          activity.type === 'response' || activity.type === 'error' ? 'completed' : 'in_progress',
        ...(activity.type === 'response' ? { conclusion: 'success' as const } : {}),
        ...(activity.type === 'error' ? { conclusion: 'failure' as const } : {}),
        summary: body,
        ...(control?.type === 'approval'
          ? {
              actions: [
                {
                  label: 'Approve',
                  description: 'Allow Athena to run this action.',
                  identifier: control.approveToken,
                },
                {
                  label: 'Reject',
                  description: 'Reject this Athena action.',
                  identifier: control.rejectToken,
                },
              ],
            }
          : {}),
      };
    }
    return { kind: 'comment', body: githubFallbackBody(body, control) };
  },
  async publish(install, session, output) {
    const http = install.http ?? defaultHttpClient;
    const [owner, repository] = session.repository.split('/');
    if (!owner || !repository) throw new Error('GitHub repository reference is invalid.');
    const headers = {
      Authorization: `Bearer ${install.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    };
    if (output.kind === 'comment') {
      const response = await http(
        `https://api.github.com/repos/${owner}/${repository}/issues/${session.issueNumber}/comments`,
        { method: 'POST', headers, body: JSON.stringify({ body: output.body }) },
      );
      const result = z
        .object({ id: z.number(), html_url: z.string().optional() })
        .parse(await response.json());
      if (!response.ok) throw new Error('GitHub did not accept the agent comment.');
      return { id: String(result.id), ...(result.html_url ? { url: result.html_url } : {}) };
    }
    if (!session.pullRequestHeadSha)
      throw new Error('GitHub check output requires a pull request head SHA.');
    const response = await http(`https://api.github.com/repos/${owner}/${repository}/check-runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: output.name,
        head_sha: session.pullRequestHeadSha,
        status: output.status,
        ...(output.conclusion ? { conclusion: output.conclusion } : {}),
        output: { title: output.name, summary: output.summary },
        ...(output.actions ? { actions: output.actions } : {}),
      }),
    });
    const result = z
      .object({ id: z.number(), html_url: z.string().optional() })
      .parse(await response.json());
    if (!response.ok) throw new Error('GitHub did not accept the agent check run.');
    return { id: String(result.id), ...(result.html_url ? { url: result.html_url } : {}) };
  },
};
