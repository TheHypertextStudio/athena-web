import { CapabilityError } from '../../error';
import type { TemplateActor } from './authorization';
import type { TemplateTransaction } from './persistence';

/** Server-registered identity metadata; persistence is rechecked before the canonical insert. */
export interface TemplateCopyReservationFacts {
  readonly entryId: string;
  readonly bundleId: string;
  readonly organizationId: string;
  readonly actorId: string;
  readonly userId: string;
  readonly destinationWorkTypeId: string;
  readonly reservedFirstVersionId: string;
}
/** Opaque server capability; copying its JSON or using another transaction grants no identity. */
export interface TemplateCopyReservation {
  readonly proof: object;
}
const reservations = new WeakMap<
  object,
  {
    readonly tx: TemplateTransaction;
    readonly capability: TemplateCopyReservation;
    readonly facts: TemplateCopyReservationFacts;
  }
>();

/** Register only after the reservation service persists checked facts on this exact transaction. */
export function registerTemplateCopyReservation(
  tx: TemplateTransaction,
  facts: TemplateCopyReservationFacts,
): TemplateCopyReservation {
  const capability = Object.freeze({ proof: Object.freeze({}) });
  reservations.set(capability.proof, { tx, capability, facts: Object.freeze({ ...facts }) });
  return capability;
}

/** Require exact capability identity, transaction, destination tenant and actual accepting actor. */
export function requireTemplateCopyReservation(
  tx: TemplateTransaction,
  capability: TemplateCopyReservation,
  actor?: Pick<TemplateActor, 'orgId' | 'actorId'>,
): TemplateCopyReservationFacts {
  const saved = reservations.get(capability.proof);
  if (
    saved?.tx !== tx ||
    saved.capability !== capability ||
    (actor !== undefined &&
      (saved.facts.organizationId !== actor.orgId || saved.facts.actorId !== actor.actorId))
  )
    throw new CapabilityError();
  return saved.facts;
}
