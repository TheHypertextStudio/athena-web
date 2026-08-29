interface LinearAgentWebhookUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly url: string;
}

interface LinearAgentActivityInput {
  readonly id: string;
  readonly body: string;
  readonly signal?: 'auth' | 'continue' | 'select' | 'stop';
  readonly signalMetadata?: Readonly<Record<string, unknown>>;
}

/** Input for one current Linear `AgentSessionEventWebhookPayload` test fixture. */
export interface LinearAgentWebhookInput {
  readonly action: 'created' | 'prompted';
  readonly organizationId: string;
  readonly sessionId: string;
  readonly webhookId?: string;
  readonly userId?: string | null;
  readonly promptContext?: string;
  readonly guidance?: readonly string[];
  readonly commentId?: string;
  readonly issue?: { readonly id: string; readonly title?: string; readonly url?: string };
  readonly activity?: LinearAgentActivityInput;
  readonly now?: Date;
}

function user(id: string): LinearAgentWebhookUser {
  return {
    id,
    email: `${id}@example.test`,
    name: 'Linear User',
    url: `https://linear.app/example/profiles/${id}`,
  };
}

/** Build the published Linear Agent session webhook shape for API tests. */
export function linearAgentWebhook(input: LinearAgentWebhookInput): Record<string, unknown> {
  const now = input.now ?? new Date();
  const actor = input.userId === null ? null : user(input.userId ?? 'linear-user');
  if (input.action === 'prompted' && (!input.activity || !actor)) {
    throw new TypeError('A prompted Linear Agent fixture requires an activity and a user.');
  }
  return {
    action: input.action,
    appUserId: 'athena-app-user',
    createdAt: now.toISOString(),
    guidance: (input.guidance ?? []).map((body) => ({
      body,
      origin: { type: 'organization' },
    })),
    oauthClientId: 'athena-linear-client',
    organizationId: input.organizationId,
    previousComments: null,
    promptContext: input.promptContext ?? null,
    type: 'AgentSessionEvent',
    webhookId: input.webhookId ?? `${input.sessionId}:${input.action}`,
    webhookTimestamp: now.getTime(),
    agentSession: {
      id: input.sessionId,
      organizationId: input.organizationId,
      commentId: input.commentId ?? null,
      sourceCommentId: null,
      ...(actor && input.action === 'created' ? { creator: actor, creatorId: actor.id } : {}),
      issue: input.issue ?? null,
      issueId: input.issue?.id ?? null,
    },
    ...(input.activity && actor
      ? {
          agentActivity: {
            agentSessionId: input.sessionId,
            content: { type: 'prompt', body: input.activity.body },
            createdAt: now.toISOString(),
            id: input.activity.id,
            signal: input.activity.signal ?? null,
            signalMetadata: input.activity.signalMetadata ?? null,
            updatedAt: now.toISOString(),
            user: actor,
            userId: actor.id,
          },
        }
      : {}),
  };
}
