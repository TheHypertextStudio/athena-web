import type { AgentSurfaceAdapter, AgentSurfaceProvider, SurfaceTypeFamily } from './agent-surface';
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
export type SurfaceTypes<P extends AgentSurfaceProvider> = AgentSurfaceRegistry[P];

type SurfaceAdapterRegistry = {
  readonly [P in AgentSurfaceProvider]: AgentSurfaceAdapter<
    P,
    Extract<SurfaceTypes<P>, SurfaceTypeFamily<P>>
  >;
};

/** Closed runtime registry for every supported external agent surface. */
export const agentSurfaceAdapters = {
  linear: linearAgentSurface,
  slack: slackAgentSurface,
  github: githubAgentSurface,
  jira_a2a: jiraA2aAgentSurface,
} satisfies SurfaceAdapterRegistry;

/** Return the adapter associated with one provider while preserving its generic key. */
export function agentSurfaceFor<P extends AgentSurfaceProvider>(
  provider: P,
): (typeof agentSurfaceAdapters)[P] {
  return agentSurfaceAdapters[provider];
}
