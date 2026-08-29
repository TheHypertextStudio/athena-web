import type {
  AgentSurfaceAdapter,
  AgentSurfaceProvider,
  AgentSurfaceRouting,
  CanonicalAgentActivity,
  CanonicalAgentEvent,
  ExternalSessionProjectionContext,
  SurfaceTypeFamily,
} from './agent-surface';
import { githubAgentSurface, type GitHubSurfaceTypes } from './agent-surface-github';
import { jiraA2aAgentSurface, type JiraA2ASurfaceTypes } from './agent-surface-jira-a2a';
import { linearAgentSurface, type LinearSurfaceTypes } from './agent-surface-linear';
import { slackAgentSurface, type SlackSurfaceTypes } from './agent-surface-slack';

export type * from './agent-surface';

type DefineSurfaceRegistry<
  T extends { readonly [P in AgentSurfaceProvider]: SurfaceTypeFamily<P> },
> = T;

/** Complete provider-to-wire-family association. */
export type AgentSurfaceRegistry = DefineSurfaceRegistry<{
  readonly linear: LinearSurfaceTypes;
  readonly slack: SlackSurfaceTypes;
  readonly github: GitHubSurfaceTypes;
  readonly jira_a2a: JiraA2ASurfaceTypes;
}>;

/** The provider-specific wire family associated with `P`. */
export type SurfaceTypes<P extends AgentSurfaceProvider> = Extract<
  AgentSurfaceRegistry[P],
  SurfaceTypeFamily<P>
>;

type SurfaceAdapterRegistry = {
  readonly [P in AgentSurfaceProvider]: AgentSurfaceAdapter<
    P,
    Extract<SurfaceTypes<P>, SurfaceTypeFamily<P>>
  >;
};

/** The adapter type associated with one provider key. */
export type SurfaceAdapterFor<P extends AgentSurfaceProvider> = AgentSurfaceAdapter<
  P,
  SurfaceTypes<P>
>;

/** One adapter from the closed registry, with its provider-specific family kept intact. */
export type AnySurfaceAdapter = {
  readonly [P in AgentSurfaceProvider]: SurfaceAdapterFor<P>;
}[AgentSurfaceProvider];

/** A stored webhook delivery before adapter-owned parsing and normalization. */
export interface StoredAgentSurfaceDelivery {
  readonly inboxProvider: string;
  readonly deliveryId: string;
  readonly eventType: string;
  readonly payload: unknown;
}

/** Provider-neutral result of normalizing one stored delivery through its registered adapter. */
export interface NormalizedAgentSurfaceDelivery {
  readonly provider: AgentSurfaceProvider;
  readonly routing: AgentSurfaceRouting;
  readonly events: readonly CanonicalAgentEvent[];
}

/** A native session reference and rendered output with their provider key preserved. */
export type AgentSurfaceProjection = {
  readonly [P in AgentSurfaceProvider]: {
    readonly provider: P;
    readonly session: SurfaceTypes<P>['sessionRef'];
    readonly output: SurfaceTypes<P>['outbound'];
  };
}[AgentSurfaceProvider];

/** A provider key paired with the native reference for one external session. */
export type AgentSurfaceSessionProjection = {
  readonly [P in AgentSurfaceProvider]: {
    readonly provider: P;
    readonly session: SurfaceTypes<P>['sessionRef'];
  };
}[AgentSurfaceProvider];

/** Closed runtime registry for every supported external agent surface. */
export const agentSurfaceAdapters = {
  linear: linearAgentSurface,
  slack: slackAgentSurface,
  github: githubAgentSurface,
  jira_a2a: jiraA2aAgentSurface,
} satisfies SurfaceAdapterRegistry;

/** Return the adapter associated with one provider while preserving its generic key. */
export function agentSurfaceFor<P extends AgentSurfaceProvider>(provider: P): SurfaceAdapterFor<P> {
  // TypeScript loses the mapped key/value correlation when a generic key indexes a concrete
  // object. The registry's `satisfies SurfaceAdapterRegistry` check above proves the association;
  // this one cast restores that already-checked fact for generic callers.
  return agentSurfaceAdapters[provider] as SurfaceAdapterFor<P>;
}

/** Whether a stored provider value names one registered surface. */
export function isAgentSurfaceProvider(value: string): value is AgentSurfaceProvider {
  return Object.hasOwn(agentSurfaceAdapters, value);
}

/** Find the adapter that owns one durable inbox provider key. */
export function agentSurfaceForInboxProvider(value: string): AnySurfaceAdapter | null {
  return (
    (Object.values(agentSurfaceAdapters) as AnySurfaceAdapter[]).find(
      (adapter) => adapter.routing.inboxProvider === value,
    ) ?? null
  );
}

async function normalizeWithAdapter<P extends AgentSurfaceProvider>(
  adapter: SurfaceAdapterFor<P>,
  input: StoredAgentSurfaceDelivery,
  connection: Readonly<Record<string, unknown>>,
): Promise<NormalizedAgentSurfaceDelivery> {
  const payload = adapter.parse(input.payload);
  const events = await adapter.normalize(
    { deliveryId: input.deliveryId, eventType: input.eventType, payload },
    adapter.nativeContext(connection),
  );
  return { provider: adapter.provider, routing: adapter.routing, events };
}

/** Parse and normalize one persisted inbox row without provider branching in the durable core. */
export async function normalizeStoredAgentSurface(
  input: StoredAgentSurfaceDelivery,
  connection: Readonly<Record<string, unknown>>,
): Promise<NormalizedAgentSurfaceDelivery | null> {
  const adapter = agentSurfaceForInboxProvider(input.inboxProvider);
  if (!adapter) return null;
  // The inbox lookup above preserves the mapped provider/family pair at runtime. TypeScript loses
  // that correlation when `Object.values` returns the closed adapter union, so restore the broad
  // generic view only at this registry boundary.
  return normalizeWithAdapter(
    adapter as SurfaceAdapterFor<AgentSurfaceProvider>,
    input,
    connection,
  );
}

function projectWithAdapter<P extends AgentSurfaceProvider>(
  adapter: SurfaceAdapterFor<P>,
  activity: CanonicalAgentActivity,
  context: Omit<ExternalSessionProjectionContext<P>, 'provider'>,
): AgentSurfaceProjection {
  const providerContext = { ...context, provider: adapter.provider };
  return {
    provider: adapter.provider,
    session: adapter.sessionRef(providerContext),
    output: adapter.render(activity, providerContext),
  } as AgentSurfaceProjection;
}

function sessionWithAdapter<P extends AgentSurfaceProvider>(
  adapter: SurfaceAdapterFor<P>,
  context: Omit<ExternalSessionProjectionContext<P>, 'provider'>,
): AgentSurfaceSessionProjection {
  return {
    provider: adapter.provider,
    session: adapter.sessionRef({ ...context, provider: adapter.provider }),
  } as AgentSurfaceSessionProjection;
}

/** Build one provider-native session reference through the registered adapter. */
export function sessionForAgentSurface(
  provider: string,
  context: Omit<ExternalSessionProjectionContext<AgentSurfaceProvider>, 'provider'>,
): AgentSurfaceSessionProjection | null {
  if (!isAgentSurfaceProvider(provider)) return null;
  return sessionWithAdapter(agentSurfaceFor(provider), context);
}

/** Build one native session reference and activity projection through the registered adapter. */
export function projectAgentSurface(
  provider: string,
  activity: CanonicalAgentActivity,
  context: Omit<ExternalSessionProjectionContext<AgentSurfaceProvider>, 'provider'>,
): AgentSurfaceProjection | null {
  if (!isAgentSurfaceProvider(provider)) return null;
  return projectWithAdapter(agentSurfaceFor(provider), activity, context);
}
