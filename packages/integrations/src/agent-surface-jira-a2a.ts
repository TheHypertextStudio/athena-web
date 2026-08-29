import { timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import type { HttpClient } from './http';
import { defaultHttpClient } from './http';
import type { AgentSurfaceAdapter, ExternalRef, SurfaceTypeFamily } from './agent-surface';
import { canonicalActivityText } from './agent-surface';

const textPartSchema = z.object({ kind: z.literal('text'), text: z.string() });
const a2aMessageSchema = z.object({
  role: z.enum(['user', 'agent']),
  parts: z.array(textPartSchema).min(1),
});
const a2aRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]),
  method: z.enum(['message/send', 'message/stream', 'tasks/cancel']),
  params: z.object({
    taskId: z.string(),
    contextId: z.string(),
    message: a2aMessageSchema.optional(),
    metadata: z
      .object({
        newSession: z.boolean().optional(),
        actorId: z.string(),
        actorEmail: z.string().optional(),
        actorName: z.string().optional(),
        choiceToken: z.string().optional(),
      })
      .loose(),
  }),
});

/** Verified A2A 1.0 JSON-RPC request from Jira Rovo. */
export type A2ARequest = z.infer<typeof a2aRequestSchema>;

/** Jira Rovo A2A verification configuration. */
export interface JiraA2AVerification {
  readonly bearerToken: string;
  readonly siteId: string;
}

/** One Jira Rovo remote-agent installation. */
export interface JiraA2AInstall extends JiraA2AVerification {
  readonly callbackUrl: string;
  readonly http?: HttpClient;
}

/** A2A task reference. */
export type A2ATaskRef = ExternalRef;

/** Native A2A message, status, input request, or artifact. */
export type A2AMessageOrArtifact =
  | { readonly kind: 'message'; readonly text: string }
  | {
      readonly kind: 'status';
      readonly state: 'working' | 'completed' | 'failed' | 'canceled';
      readonly text: string;
    }
  | {
      readonly kind: 'input_required';
      readonly text: string;
      readonly choices?: readonly { readonly label: string; readonly value: string }[];
      readonly url?: string;
    };

/** Jira Rovo's A2A wire family. */
export interface JiraA2ASurfaceTypes extends SurfaceTypeFamily<'jira_a2a'> {
  readonly verification: JiraA2AVerification;
  readonly install: JiraA2AInstall;
  readonly webhook: A2ARequest;
  readonly workspaceRef: ExternalRef;
  readonly sessionRef: A2ATaskRef;
  readonly actorRef: ExternalRef;
  readonly nativeContext: { readonly contextId: string };
  readonly outbound: A2AMessageOrArtifact;
  readonly receipt: ExternalRef;
}

function secureTokenEqual(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function messageText(request: A2ARequest): string {
  return request.params.message?.parts.map((part) => part.text).join('\n') ?? '';
}

/** Jira Rovo A2A 1.0 adapter. */
export const jiraA2aAgentSurface: AgentSurfaceAdapter<'jira_a2a', JiraA2ASurfaceTypes> = {
  provider: 'jira_a2a',
  capabilities: {
    progress: 'stream',
    approval: 'reply',
    authentication: 'plain_link',
    stop: 'reply',
    plans: false,
  },
  routing: {
    displayName: 'Jira Agent',
    destinationName: 'Jira',
    inboxProvider: 'jira_a2a',
    installProvider: 'jira_a2a',
    identitySource: null,
    workGraphProvider: null,
    turnProvenance: 'external_agent',
    stopAuthority: 'provider_event',
  },
  nativeContext(connection) {
    const contextId = connection['externalWorkspaceId'];
    if (typeof contextId !== 'string') {
      throw new Error('Jira A2A install is missing its site id.');
    }
    return { contextId };
  },
  sessionRef(context) {
    return { id: context.externalSessionId };
  },
  async verify(input, verification) {
    const authorization = input.headers['authorization'];
    const expected = `Bearer ${verification.bearerToken}`;
    if (!authorization || !secureTokenEqual(authorization, expected)) {
      throw new Error('Jira A2A authorization is invalid.');
    }
    const payload = jiraA2aAgentSurface.parse(JSON.parse(input.body));
    const headerRequestId = input.headers['x-request-id'];
    const deliveryId = headerRequestId ?? String(payload.id);
    return { deliveryId, eventType: payload.method, payload };
  },
  parse(payload) {
    return a2aRequestSchema.parse(payload);
  },
  route(input) {
    return { workspaceId: input.payload.params.contextId };
  },
  async normalize(input, context) {
    const payload = input.payload;
    if (payload.params.contextId !== context.contextId)
      throw new Error('Jira A2A site does not match the installation.');
    const actor = {
      externalId: payload.params.metadata.actorId,
      ...(payload.params.metadata.actorEmail ? { email: payload.params.metadata.actorEmail } : {}),
      ...(payload.params.metadata.actorName
        ? { displayName: payload.params.metadata.actorName }
        : {}),
    };
    if (payload.method === 'tasks/cancel') {
      return [
        {
          type: 'stop_requested',
          externalSessionId: payload.params.taskId,
          externalActivityId: String(payload.id),
          actor,
        },
      ];
    }
    const choiceToken = payload.params.metadata.choiceToken;
    if (choiceToken) {
      return [
        {
          type: 'approval_selected',
          externalSessionId: payload.params.taskId,
          externalActivityId: String(payload.id),
          actor,
          choiceToken,
        },
      ];
    }
    const body = messageText(payload);
    if (payload.params.metadata.newSession) {
      return [
        {
          type: 'session_started',
          workspaceId: payload.params.contextId,
          externalSessionId: payload.params.taskId,
          actor,
          context: { prompt: body, guidance: [], references: [] },
          trigger: 'message',
        },
      ];
    }
    return [
      {
        type: 'prompt_received',
        externalSessionId: payload.params.taskId,
        externalActivityId: String(payload.id),
        actor,
        body,
      },
    ];
  },
  render(activity) {
    const text = canonicalActivityText(activity);
    const control = activity.control;
    if (control?.type === 'approval') {
      return {
        kind: 'input_required',
        text,
        choices: [
          { label: 'Approve', value: control.approveToken },
          { label: 'Reject', value: control.rejectToken },
        ],
      };
    }
    if (control?.type === 'authentication')
      return { kind: 'input_required', text, url: control.url };
    if (control?.type === 'stop') {
      return {
        kind: 'input_required',
        text,
        choices: [{ label: 'Stop Athena', value: control.stopToken }],
      };
    }
    if (activity.type === 'thought' || activity.type === 'action')
      return { kind: 'status', state: 'working', text };
    if (activity.type === 'error') return { kind: 'status', state: 'failed', text };
    if (activity.type === 'response') return { kind: 'message', text };
    return { kind: 'input_required', text };
  },
  async publish(install, session, output) {
    const http = install.http ?? defaultHttpClient;
    const response = await http(install.callbackUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${install.bearerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tasks/pushNotification',
        params: { taskId: session.id, output },
      }),
    });
    if (!response.ok) throw new Error('Jira A2A callback rejected the agent output.');
    const receipt = z
      .object({ id: z.union([z.string(), z.number()]).optional() })
      .loose()
      .parse(await response.json().catch(() => ({})));
    return { id: String(receipt.id ?? `${session.id}:${Date.now()}`) };
  },
};
