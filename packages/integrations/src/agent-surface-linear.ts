import { z } from 'zod';

import {
  agentActivityCreate,
  LinearAgentClient,
  verifyLinearAgentWebhookSignature,
} from './linear-agent';
import type {
  AgentSurfaceAdapter,
  CanonicalExternalActor,
  ExternalRef,
  SurfaceTypeFamily,
} from './agent-surface';
import { canonicalActivityText } from './agent-surface';

const linearActorSchema = z.object({
  id: z.string(),
  email: z.string().optional(),
  name: z.string().optional(),
});

const linearSessionSchema = z
  .object({
    id: z.string(),
    promptContext: z.string().optional(),
    guidance: z.array(z.string()).optional(),
    issue: z
      .object({ id: z.string(), title: z.string().optional(), url: z.string().optional() })
      .optional(),
  })
  .loose();

const linearWebhookSchema = z
  .object({
    action: z.enum(['created', 'prompted']),
    type: z.string().optional(),
    organizationId: z.string(),
    webhookTimestamp: z.number(),
    agentSession: linearSessionSchema,
    actor: linearActorSchema.optional(),
    agentActivity: z
      .object({
        id: z.string(),
        body: z.string().optional(),
        signal: z
          .object({
            type: z.enum(['select', 'auth', 'stop']),
            value: z.string().optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .loose();

/** Verified Linear Agent webhook. */
export type LinearAgentSurfaceWebhook = z.infer<typeof linearWebhookSchema>;

/** Linear Agent app verification configuration. */
export interface LinearAgentVerification {
  readonly signingSecret: string;
}

/** One installed Linear Agent app. */
export interface LinearAgentInstall extends LinearAgentVerification {
  readonly accessToken: string;
}

/** Linear Agent session reference. */
export type LinearAgentSessionRef = ExternalRef;

/** Linear Agent outbound activity. */
export interface LinearAgentSurfaceOutput {
  readonly type: 'thought' | 'action' | 'response' | 'elicitation' | 'error';
  readonly body: string;
  readonly ephemeral?: boolean;
  readonly signal?:
    | {
        readonly type: 'select';
        readonly options: readonly { readonly label: string; readonly value: string }[];
      }
    | { readonly type: 'auth'; readonly url: string; readonly userId: string }
    | { readonly type: 'stop'; readonly value: string };
}

/** Linear's external-agent wire family. */
export interface LinearSurfaceTypes extends SurfaceTypeFamily<'linear'> {
  readonly verification: LinearAgentVerification;
  readonly install: LinearAgentInstall;
  readonly webhook: LinearAgentSurfaceWebhook;
  readonly workspaceRef: ExternalRef;
  readonly sessionRef: LinearAgentSessionRef;
  readonly actorRef: ExternalRef;
  readonly nativeContext: Readonly<Record<string, never>>;
  readonly outbound: LinearAgentSurfaceOutput;
  readonly receipt: ExternalRef;
}

function actor(payload: LinearAgentSurfaceWebhook): CanonicalExternalActor {
  if (!payload.actor) return { externalId: `unknown:${payload.agentSession.id}` };
  return {
    externalId: payload.actor.id,
    ...(payload.actor.email ? { email: payload.actor.email } : {}),
    ...(payload.actor.name ? { displayName: payload.actor.name } : {}),
  };
}

/** Linear Agent adapter. */
export const linearAgentSurface: AgentSurfaceAdapter<'linear', LinearSurfaceTypes> = {
  provider: 'linear',
  capabilities: {
    progress: 'activity',
    approval: 'select',
    authentication: 'signal',
    stop: 'signal',
    plans: true,
  },
  routing: {
    displayName: 'Linear Agent',
    destinationName: 'Linear',
    inboxProvider: 'linear_agent',
    installProvider: 'linear_agent',
    identitySource: 'linear',
    workGraphProvider: 'linear',
    turnProvenance: 'linear',
    stopAuthority: 'provider_event',
  },
  nativeContext() {
    return {};
  },
  sessionRef(context) {
    return { id: context.externalSessionId };
  },
  async verify(input, verification) {
    if (
      !verifyLinearAgentWebhookSignature(
        input.body,
        { ...input.headers },
        verification.signingSecret,
      )
    ) {
      throw new Error('Linear Agent webhook signature is invalid or stale.');
    }
    const payload = linearAgentSurface.parse(JSON.parse(input.body));
    return {
      deliveryId: payload.agentActivity?.id ?? `${payload.agentSession.id}:${payload.action}`,
      eventType: payload.action,
      payload,
    };
  },
  parse(payload) {
    return linearWebhookSchema.parse(payload);
  },
  route(input) {
    return { workspaceId: input.payload.organizationId };
  },
  async normalize(input) {
    const payload = input.payload;
    const externalActor = actor(payload);
    if (payload.action === 'created') {
      const issue = payload.agentSession.issue;
      return [
        {
          type: 'session_started',
          workspaceId: payload.organizationId,
          externalSessionId: payload.agentSession.id,
          actor: externalActor,
          trigger: 'mention',
          context: {
            prompt:
              payload.agentSession.promptContext ??
              issue?.title ??
              'Help with this Linear work item.',
            guidance: payload.agentSession.guidance ?? [],
            ...(issue
              ? {
                  workItem: {
                    externalId: issue.id,
                    ...(issue.title ? { title: issue.title } : {}),
                    ...(issue.url ? { url: issue.url } : {}),
                  },
                }
              : {}),
            references: issue?.url ? [{ id: issue.id, url: issue.url }] : [],
          },
        },
      ];
    }
    const activity = payload.agentActivity;
    if (!activity) return [];
    if (activity.signal?.type === 'select' && activity.signal.value) {
      return [
        {
          type: 'approval_selected',
          externalSessionId: payload.agentSession.id,
          externalActivityId: activity.id,
          actor: externalActor,
          choiceToken: activity.signal.value,
        },
      ];
    }
    if (activity.signal?.type === 'auth') return [];
    if (activity.signal?.type === 'stop') {
      return [
        {
          type: 'stop_requested',
          externalSessionId: payload.agentSession.id,
          externalActivityId: activity.id,
          actor: externalActor,
          ...(activity.signal.value ? { stopToken: activity.signal.value } : {}),
        },
      ];
    }
    if (!activity.body) return [];
    return [
      {
        type: 'prompt_received',
        externalSessionId: payload.agentSession.id,
        externalActivityId: activity.id,
        actor: externalActor,
        body: activity.body,
      },
    ];
  },
  render(activity) {
    const control = activity.control;
    return {
      type: activity.type,
      body: canonicalActivityText(activity),
      ...(activity.ephemeral ? { ephemeral: true } : {}),
      ...(control?.type === 'approval'
        ? {
            signal: {
              type: 'select' as const,
              options: [
                { label: 'Approve', value: control.approveToken },
                { label: 'Reject', value: control.rejectToken },
              ],
            },
          }
        : control?.type === 'authentication'
          ? {
              signal: {
                type: 'auth' as const,
                url: control.url,
                userId: control.externalActorId,
              },
            }
          : control?.type === 'stop'
            ? { signal: { type: 'stop' as const, value: control.stopToken } }
            : {}),
    };
  },
  async publish(install, session, output) {
    const result = await agentActivityCreate(new LinearAgentClient(install.accessToken), {
      agentSessionId: session.id,
      type: output.type,
      body: output.body,
      ...(output.ephemeral !== undefined ? { ephemeral: output.ephemeral } : {}),
      ...(output.signal?.type === 'select'
        ? {
            signal: 'select' as const,
            signalMetadata: { options: output.signal.options },
          }
        : output.signal?.type === 'auth'
          ? {
              signal: 'auth' as const,
              signalMetadata: {
                url: output.signal.url,
                userId: output.signal.userId,
                providerName: 'Docket',
              },
            }
          : {}),
    });
    return result;
  },
};
