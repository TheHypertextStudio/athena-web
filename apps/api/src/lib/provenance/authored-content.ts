/** Keep content authorship separate from the actor who authorized the write. */
import { readOrigin, toActivityOrigin } from '@docket/work/provenance-contract';
import type { ChangeOrigin } from '@docket/work/provenance-contract';
import type { ActorRef } from '@docket/connections/event-contract';
import { currentProvenance, originFor } from './context';

/** Resolve the displayed author and stored origin for a comment or status report. */
export function authoredContent(
  authorityActorId: string,
  tool: 'comment' | 'edit_comment' | 'report_status',
) {
  const origin = originFor(tool);
  const performer = origin.performer;
  return {
    authorId: performer.kind === 'person' ? authorityActorId : (performer.actorId ?? null),
    origin,
  };
}

/** Check ownership against the verified performer as well as the authorizing actor. */
export function ownsAuthoredContent(
  row: { authorId: string | null; createdBy: string | null; origin: ChangeOrigin | null },
  authorityActorId: string,
): boolean {
  const current = currentProvenance();
  if (!current) return false;
  const original = readOrigin(row.origin);
  if (current.performer.kind === 'person') {
    return (
      row.authorId === authorityActorId &&
      (original === null || original.performer.kind === 'person')
    );
  }
  if (current.performer.actorId) {
    return (
      row.authorId === current.performer.actorId &&
      original?.performer.actorId === current.performer.actorId
    );
  }
  return sameConnectedClient(
    row.createdBy,
    authorityActorId,
    original,
    current.performer.kind,
    current.clientId,
  );
}

/** A client can own its own text only under the same human authority. */
function sameConnectedClient(
  createdBy: string | null,
  authorityActorId: string,
  original: ReturnType<typeof readOrigin>,
  performerKind: string,
  clientId: string | undefined,
): boolean {
  return Boolean(
    clientId &&
    createdBy === authorityActorId &&
    original?.performer.kind === performerKind &&
    original.client?.id === clientId,
  );
}

/** Expose the stored performer to content readers without the full audit record. */
export function contentOrigin(origin: ChangeOrigin | null) {
  const provenance = readOrigin(origin);
  return provenance ? toActivityOrigin(provenance) : null;
}

/** Name an agent without an Actor in a stream event. */
export function contentEventActor(origin: ChangeOrigin | null): ActorRef | null {
  const provenance = readOrigin(origin);
  if (!provenance || provenance.performer.kind === 'person' || provenance.performer.actorId) {
    return null;
  }
  const name = provenance.performer.name ?? provenance.client?.name ?? 'Agent';
  return {
    source: 'docket',
    externalId: provenance.client?.id ?? `agent:${name}`,
    displayName: name,
    avatarUrl: null,
    docketActorId: null,
  };
}
