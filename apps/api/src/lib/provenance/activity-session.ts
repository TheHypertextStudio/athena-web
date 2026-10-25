/** Correlation of work contributions; never a source of authority or delegation claims. */
import { createHash } from 'node:crypto';
import type { TaskActivitySession } from '@docket/connections/activity-contract';
import { readOrigin, type ChangeOrigin, type Provenance } from '@docket/work/provenance-contract';
import { ValidationError } from '../../error';
import type { ProvenanceBase } from './context';

/** Optional REST correlation header for authenticated integrations. */
export const ACTIVITY_SESSION_HEADER = 'Docket-Activity-Session';
/** Optional per-tool-call MCP correlation metadata key. */
export const ACTIVITY_SESSION_META = 'io.docket/activity-session';

/** Add a bounded work key to agent provenance without changing its authenticated identity. */
export function withActivitySession(base: ProvenanceBase, key: unknown): ProvenanceBase {
  if (key === undefined) return base;
  if (typeof key !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(key)) {
    throw new ValidationError([
      { message: 'Invalid activity session key', path: ['activitySession'] },
    ]);
  }
  if (base.performer.kind !== 'agent' || base.channel === 'athena' || base.agentSessionId)
    return base;
  return { ...base, activitySessionId: key };
}

/** Scope an opaque grouping identity to the work and the authenticated authority behind it. */
interface ActivityScope {
  readonly taskId: string;
  readonly actorId: string | null;
}

/** Project recorded correlation into a public descriptor without exposing transport handles. */
export function activitySessionOf(
  scope: ActivityScope,
  origin: ChangeOrigin | null | undefined,
): TaskActivitySession | null {
  const provenance = readOrigin(origin);
  if (!provenance || !origin) return null;
  if (!['agent', 'athena'].includes(provenance.performer.kind)) return null;
  const identity = sessionIdentity(scope, origin, provenance);
  if (!identity) return null;
  const { kind, parts } = identity;
  const id = createHash('sha256').update(JSON.stringify(parts)).digest('hex');
  const name = provenance.performer.name ?? provenance.client?.name ?? 'Agent';
  return { id, kind, title: `${name} ${kind === 'connection' ? 'connection' : 'session'}` };
}

/** Select the recorded identity without manufacturing sessions from time or client names. */
function sessionIdentity(
  scope: ActivityScope,
  origin: ChangeOrigin,
  provenance: Provenance,
): {
  readonly kind: TaskActivitySession['kind'];
  readonly parts: readonly unknown[];
} | null {
  const native =
    origin.agentSessionId ?? (provenance.channel === 'athena' ? provenance.sessionId : null);
  if (native) return { kind: 'native', parts: [scope.taskId, 'native', native] };
  if (scope.actorId === null) return null;
  const key = origin.activitySessionId ?? provenance.sessionId;
  if (!key) return null;
  const kind = origin.activitySessionId ? 'work' : 'connection';
  return {
    kind,
    parts: [
      scope.taskId,
      scope.actorId,
      provenance.channel,
      provenance.performer.actorId ?? null,
      externalClientIdentity(origin, provenance),
      kind,
      key,
    ],
  };
}

/** Prefer authenticated client identity; legacy provenance may only have a saved display name. */
function externalClientIdentity(origin: ChangeOrigin, provenance: Provenance): string | null {
  return origin.clientId ?? provenance.client?.name ?? provenance.performer.name ?? null;
}
