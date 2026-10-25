import type { SessionRow } from '../routes/agent-session-helpers';
import type { ToolboxExecutor } from './toolbox';

/** Return the workspace named by a Docket tool input, when present. */
export function toolOrganizationId(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const value = (input as Record<string, unknown>)['orgId'];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Build the toolbox identity exclusively from the persisted executor columns. */
export function toolboxExecutor(session: SessionRow): ToolboxExecutor {
  if (session.executorKind === 'athena') {
    /* v8 ignore next -- @preserve defensive: agent_session_executor_shape_check guarantees an
       athena session's ownerUserId is NOT NULL at the database level */
    if (!session.ownerUserId) throw new Error('Athena session is missing its owner');
    return { kind: 'athena', ownerUserId: session.ownerUserId, sessionKind: session.kind };
  }
  /* v8 ignore next 3 -- @preserve defensive: agent_session_executor_shape_check guarantees a
     registered_agent session's organizationId and agentId are both NOT NULL at the database
     level */
  if (!session.organizationId || !session.agentId) {
    throw new Error('Registered-agent session is missing its workspace identity');
  }
  return {
    kind: 'registered_agent',
    organizationId: session.organizationId,
    agentId: session.agentId,
  };
}

/** Return an Athena owner after checking the persisted executor shape. */
export function requireAthenaOwner(session: SessionRow): string {
  /* v8 ignore next 3 -- @preserve defensive: the sole caller only invokes this inside an
     `executorKind === 'athena'` branch, and agent_session_executor_shape_check guarantees such a
     session's ownerUserId is NOT NULL at the database level */
  if (session.executorKind !== 'athena' || !session.ownerUserId) {
    throw new Error('Athena session is missing its owner');
  }
  return session.ownerUserId;
}

/** Return a registered agent id after checking the persisted executor shape. */
export function requireRegisteredAgentId(session: SessionRow): string {
  /* v8 ignore next 3 -- @preserve defensive: every caller only invokes this inside an
     `executorKind === 'registered_agent'` branch, and agent_session_executor_shape_check
     guarantees such a session's agentId is NOT NULL at the database level */
  if (session.executorKind !== 'registered_agent' || !session.agentId) {
    throw new Error('Registered-agent session is missing its agent');
  }
  return session.agentId;
}

/** Workspace attribution for personal-neutral versus registered-agent activity. */
export function generalActivityOrganizationId(session: SessionRow): string | null {
  return session.executorKind === 'athena' ? null : session.organizationId;
}
