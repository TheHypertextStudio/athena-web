/** Provider ids supported by Athena's external agent boundary. */
export type AgentSurfaceProvider = 'linear' | 'slack' | 'github' | 'jira_a2a';

/** A provider-owned resource reference. */
export interface ExternalRef {
  readonly id: string;
  readonly url?: string;
}

/** The wire-type family that one external agent provider owns. */
export interface SurfaceTypeFamily<P extends AgentSurfaceProvider> {
  readonly provider: P;
  readonly verification: object;
  readonly install: object;
  readonly webhook: object;
  readonly workspaceRef: ExternalRef;
  readonly sessionRef: ExternalRef;
  readonly actorRef: ExternalRef;
  readonly nativeContext: object;
  readonly outbound: object;
  readonly receipt: ExternalRef;
}

/** Exact webhook bytes and headers as received at the HTTP edge. */
export interface RawWebhook {
  readonly body: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly receivedAt: Date;
}

/** A provider delivery after signature and schema verification. */
export interface VerifiedWebhook<TPayload extends object> {
  readonly deliveryId: string;
  readonly eventType: string;
  readonly payload: TPayload;
}

/** Installation-routing key extracted from a verified provider delivery. */
export interface AgentSurfaceRoute {
  readonly workspaceId: string;
}

/** An external person reference that can be mapped to a Docket actor. */
export interface CanonicalExternalActor {
  readonly externalId: string;
  readonly email?: string;
  readonly displayName?: string;
}

/** Provider content that Athena may use as the prompt envelope. */
export interface CanonicalPromptContext {
  readonly prompt: string;
  readonly guidance: readonly string[];
  readonly workItem?: {
    readonly externalId: string;
    readonly title?: string;
    readonly url?: string;
  };
  readonly references: readonly ExternalRef[];
}

/** Provider input after normalization into the durable session core. */
export type CanonicalAgentEvent =
  | {
      readonly type: 'session_started';
      readonly workspaceId: string;
      readonly externalSessionId: string;
      readonly actor: CanonicalExternalActor;
      readonly context: CanonicalPromptContext;
      readonly trigger: 'mention' | 'delegation' | 'message';
    }
  | {
      readonly type: 'prompt_received';
      readonly externalSessionId: string;
      readonly externalActivityId: string;
      readonly actor: CanonicalExternalActor;
      readonly body: string;
    }
  | {
      readonly type: 'approval_selected';
      readonly externalSessionId: string;
      readonly externalActivityId: string;
      readonly actor: CanonicalExternalActor;
      readonly choiceToken: string;
    }
  | {
      readonly type: 'authentication_requested';
      readonly externalSessionId: string;
      readonly externalActivityId: string;
      readonly actor: CanonicalExternalActor;
      readonly continuationToken: string;
    }
  | {
      readonly type: 'stop_requested';
      readonly externalSessionId: string;
      readonly externalActivityId: string;
      readonly actor: CanonicalExternalActor;
      readonly stopToken?: string;
    };

/** Provider-native interaction support declared by an adapter. */
export type AgentSurfaceCapabilities = Readonly<{
  progress: 'activity' | 'message_status' | 'check_run' | 'stream';
  approval: 'select' | 'buttons' | 'check_actions' | 'reply';
  authentication: 'signal' | 'button_link' | 'plain_link';
  stop: 'signal' | 'button' | 'reply';
  plans: boolean;
}>;

/** A provider-neutral control attached to a canonical activity. */
export type CanonicalAgentControl =
  | {
      readonly type: 'approval';
      readonly activityId: string;
      readonly approveToken: string;
      readonly rejectToken: string;
    }
  | {
      readonly type: 'authentication';
      readonly url: string;
      readonly externalActorId: string;
    }
  | {
      readonly type: 'stop';
      readonly stopToken: string;
    };

/** The structured action result needed by external renderers. */
export interface CanonicalActionBody {
  readonly summary?: string;
  readonly result?: { readonly content: string; readonly isError?: boolean };
}

/** The provider-neutral activity body projected from `session_activity`. */
export interface CanonicalActivityBody {
  readonly text?: string;
  readonly action?: CanonicalActionBody;
}

/** One persisted Athena activity ready for provider projection. */
export interface CanonicalAgentActivity {
  readonly id: string;
  readonly type: 'thought' | 'action' | 'response' | 'elicitation' | 'error';
  readonly body: CanonicalActivityBody;
  readonly approvalStatus: 'proposed' | 'approved' | 'executing' | 'rejected' | 'applied' | null;
  readonly control?: CanonicalAgentControl;
  readonly ephemeral: boolean;
  readonly updatedAt: Date;
}

/** Provider origin data needed to render one session activity. */
export interface ExternalSessionProjectionContext<P extends AgentSurfaceProvider> {
  readonly provider: P;
  readonly externalWorkspaceId: string;
  readonly externalSessionId: string;
  readonly externalWorkItemId?: string;
}

/**
 * One provider adapter with compile-time pairing between its verification, wire, and output types.
 *
 * @typeParam P - The provider whose family the adapter implements.
 * @typeParam F - The provider's complete wire-type family.
 */
export interface AgentSurfaceAdapter<
  P extends AgentSurfaceProvider,
  F extends SurfaceTypeFamily<P>,
> {
  readonly provider: P;
  readonly capabilities: AgentSurfaceCapabilities;
  verify(
    input: RawWebhook,
    verification: F['verification'],
  ): Promise<VerifiedWebhook<F['webhook']>>;
  parse(payload: unknown): F['webhook'];
  route(input: VerifiedWebhook<F['webhook']>): AgentSurfaceRoute;
  normalize(
    input: VerifiedWebhook<F['webhook']>,
    context: F['nativeContext'],
  ): Promise<readonly CanonicalAgentEvent[]>;
  render(
    activity: CanonicalAgentActivity,
    context: ExternalSessionProjectionContext<P>,
  ): F['outbound'];
  publish(
    install: F['install'],
    session: F['sessionRef'],
    output: F['outbound'],
  ): Promise<F['receipt']>;
}

/** Render the visible text carried by one canonical activity. */
export function canonicalActivityText(activity: CanonicalAgentActivity): string {
  if (activity.type !== 'action') return activity.body.text ?? '';
  const summary = activity.body.action?.summary ?? 'Action';
  const result = activity.body.action?.result;
  if (!result) return summary;
  return result.isError
    ? `${summary}\n\nFailed: ${result.content}`
    : `${summary}\n\n${result.content}`;
}
