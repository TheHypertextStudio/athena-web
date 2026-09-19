import { z } from 'zod';

import {
  agentActivityCreate,
  LinearAgentClient,
  verifyLinearAgentWebhookSignature,
} from './linear-agent';
import type {
  AgentSurfaceAdapter,
  CanonicalAgentControl,
  CanonicalExternalActor,
  ExternalRef,
  SurfaceTypeFamily,
} from './agent-surface';
import { canonicalActivityText } from './agent-surface';

const linearUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  url: z.string(),
});

const linearSessionSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  creator: linearUserSchema.nullish(),
  creatorId: z.string().nullish(),
  commentId: z.string().nullish(),
  sourceCommentId: z.string().nullish(),
  issue: z
    .object({ id: z.string(), title: z.string().nullish(), url: z.string().nullish() })
    .nullish(),
  issueId: z.string().nullish(),
});

const linearActivitySchema = z.object({
  agentSessionId: z.string(),
  content: z.object({ type: z.literal('prompt'), body: z.string() }),
  createdAt: z.string(),
  id: z.string(),
  signal: z.enum(['auth', 'continue', 'select', 'stop']).nullish(),
  signalMetadata: z.record(z.string(), z.unknown()).nullish(),
  updatedAt: z.string(),
  user: linearUserSchema,
  userId: z.string(),
});

const linearWebhookSchema = z.object({
  action: z.enum(['created', 'prompted']),
  appUserId: z.string(),
  createdAt: z.string(),
  guidance: z.array(z.object({ body: z.string(), origin: z.record(z.string(), z.unknown()) })),
  oauthClientId: z.string(),
  organizationId: z.string(),
  previousComments: z.array(z.unknown()).nullish(),
  promptContext: z.string().nullish(),
  type: z.literal('AgentSessionEvent'),
  webhookId: z.string(),
  webhookTimestamp: z.number(),
  agentSession: linearSessionSchema,
  agentActivity: linearActivitySchema.nullish(),
});

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

type LinearAgentSurfaceSignal =
  | {
      readonly type: 'select';
      readonly options: readonly { readonly label: string; readonly value: string }[];
    }
  | { readonly type: 'auth'; readonly url: string; readonly userId: string }
  | { readonly type: 'stop'; readonly value: string };

interface LinearAgentSurfaceOutputBase {
  readonly ephemeral?: boolean;
  readonly signal?: LinearAgentSurfaceSignal;
}

/** Linear Agent outbound activity, paired to Linear's content union by `type`. */
export type LinearAgentSurfaceOutput = LinearAgentSurfaceOutputBase &
  (
    | {
        readonly type: 'thought' | 'response' | 'elicitation' | 'error';
        readonly body: string;
      }
    | {
        readonly type: 'action';
        readonly action: string;
        readonly parameter: string;
        readonly result?: string;
      }
  );

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
  const user =
    payload.action === 'prompted' ? payload.agentActivity?.user : payload.agentSession.creator;
  if (!user) return { externalId: `unknown:${payload.agentSession.id}` };
  return {
    externalId: user.id,
    email: user.email,
    displayName: user.name,
  };
}

/**
 * Translate a canonical control into the Linear signal that renders it.
 *
 * @param control - The control attached to the canonical activity, if any.
 * @returns The matching Linear signal, or `undefined` when the activity carries no control.
 */
function buildRenderSignal(
  control: CanonicalAgentControl | undefined,
): LinearAgentSurfaceSignal | undefined {
  switch (control?.type) {
    case 'approval':
      return {
        type: 'select',
        options: [
          { label: 'Approve', value: control.approveToken },
          { label: 'Reject', value: control.rejectToken },
        ],
      };
    case 'authentication':
      return { type: 'auth', url: control.url, userId: control.externalActorId };
    case 'stop':
      return { type: 'stop', value: control.stopToken };
    default:
      return undefined;
  }
}

/**
 * The `signal` and `signalMetadata` fields Linear's activity-create input expects.
 *
 * @remarks
 * A union of "both present" and "neither present" rather than two optional properties, because
 * `exactOptionalPropertyTypes` makes an absent optional property and an explicit `undefined`
 * different things, and the activity-create input accepts only the former.
 */
type LinearPublishSignal =
  | Record<string, never>
  | {
      readonly signal: 'select';
      readonly signalMetadata: LinearSelectMetadata;
    }
  | {
      readonly signal: 'auth';
      readonly signalMetadata: LinearAuthMetadata;
    };

/** Linear's `select` signal metadata: the options the person picks from. */
interface LinearSelectMetadata {
  readonly options: readonly { readonly label?: string; readonly value: string }[];
}

/** Linear's `auth` signal metadata: where to authenticate, and as whom. */
interface LinearAuthMetadata {
  readonly url: string;
  readonly userId?: string;
  readonly providerName?: string;
}

/**
 * Flatten an outbound signal into Linear's activity-create signal fields.
 *
 * @param signal - The signal on the outbound activity, if any.
 * @returns The fields to spread into the activity-create input; empty when nothing is signalled.
 */
function extractPublishSignal(signal: LinearAgentSurfaceSignal | undefined): LinearPublishSignal {
  switch (signal?.type) {
    case 'select':
      return { signal: 'select', signalMetadata: { options: signal.options } };
    case 'auth':
      return {
        signal: 'auth',
        signalMetadata: { url: signal.url, userId: signal.userId, providerName: 'Docket' },
      };
    default:
      return {};
  }
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
    const deliveryId = input.headers['linear-delivery'];
    if (!deliveryId) throw new Error('Linear Agent delivery id is missing.');
    const payload = linearAgentSurface.parse(JSON.parse(input.body));
    return {
      deliveryId,
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
          trigger:
            payload.agentSession.commentId || payload.agentSession.sourceCommentId
              ? 'mention'
              : 'delegation',
          context: {
            prompt: payload.promptContext ?? issue?.title ?? 'Help with this Linear work item.',
            guidance: payload.guidance.map((rule) => rule.body),
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
    const body = activity.content.body;
    if (activity.signal === 'select') {
      const metadataValue = activity.signalMetadata?.['value'];
      return [
        {
          type: 'approval_selected',
          externalSessionId: payload.agentSession.id,
          externalActivityId: activity.id,
          actor: externalActor,
          choiceToken: typeof metadataValue === 'string' ? metadataValue : body,
        },
      ];
    }
    if (activity.signal === 'auth') return [];
    if (activity.signal === 'stop') {
      return [
        {
          type: 'stop_requested',
          externalSessionId: payload.agentSession.id,
          externalActivityId: activity.id,
          actor: externalActor,
        },
      ];
    }
    return [
      {
        type: 'prompt_received',
        externalSessionId: payload.agentSession.id,
        externalActivityId: activity.id,
        actor: externalActor,
        body,
      },
    ];
  },
  render(activity) {
    const control = activity.control;
    const signal = buildRenderSignal(control);
    const common = {
      ...(activity.ephemeral ? { ephemeral: true } : {}),
      ...(signal ? { signal } : {}),
    };
    if (activity.type === 'action') {
      const result = activity.body.action?.result;
      return {
        ...common,
        type: activity.type,
        action: activity.body.action?.summary ?? 'Action',
        parameter: activity.body.text ?? 'Docket',
        ...(result
          ? { result: result.isError ? `Failed: ${result.content}` : result.content }
          : {}),
      };
    }
    return {
      ...common,
      type: activity.type,
      body: canonicalActivityText(activity),
    };
  },
  async publish(install, session, output) {
    const signal = extractPublishSignal(output.signal);
    const input =
      output.type === 'action'
        ? {
            agentSessionId: session.id,
            type: output.type,
            action: output.action,
            parameter: output.parameter,
            ...(output.result !== undefined ? { result: output.result } : {}),
            ...(output.ephemeral !== undefined ? { ephemeral: output.ephemeral } : {}),
            ...signal,
          }
        : {
            agentSessionId: session.id,
            type: output.type,
            body: output.body,
            ...(output.ephemeral !== undefined ? { ephemeral: output.ephemeral } : {}),
            ...signal,
          };
    const result = await agentActivityCreate(new LinearAgentClient(install.accessToken), input);
    return result;
  },
};
