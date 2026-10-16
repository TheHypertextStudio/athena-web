import { z } from 'zod';
import { TeamId } from '@docket/identity-access/ids';
import { BlueprintError } from '../blueprints/errors';
import { WorkTypeId, WorkTypeVersionId } from '../ids';
import { CopySourceIdentity, copyIdentityKey } from './copy-identity';
import type {
  CopyDefinitionSource,
  ReservedCopyDestination,
  ReservedTemplateCopyInput,
  TemplateCopySourcesInput,
} from './copy-prospective-types';

const destinationSchema = z.strictObject({
  kind: z.literal('reserved'),
  source: CopySourceIdentity,
  workTypeId: WorkTypeId,
  reservedFirstPublicationId: WorkTypeVersionId,
});

/** Exact pending destinations; IDs here are reservations rather than executable publications. */
export class ProspectiveCopyDestinations {
  readonly values = new Map<string, ReservedCopyDestination>();
  constructor(input: ReservedTemplateCopyInput, selected: readonly CopyDefinitionSource[]) {
    for (const value of input.destinations) {
      const checked = destinationSchema.safeParse(value);
      if (!checked.success)
        throw new BlueprintError(
          'blueprint_invalid',
          'Destination identities must be explicit reservations.',
        );
      const source = checked.data.source,
        key = copyIdentityKey(source);
      if (this.values.has(key))
        throw new BlueprintError('blueprint_invalid', 'Duplicate destination mapping.');
      this.values.set(key, {
        kind: 'reserved',
        source,
        workTypeId: WorkTypeId.parse(value.workTypeId),
        reservedFirstPublicationId: WorkTypeVersionId.parse(value.reservedFirstPublicationId),
      });
    }
    const sourceIds = new Set(
      input.sources.flatMap(({ identity }) => [
        identity.workTypeId,
        ...('workTypeVersionId' in identity
          ? [identity.workTypeVersionId]
          : 'catalogVersionId' in identity
            ? [String(identity.catalogVersionId)]
            : []),
      ]),
    );
    for (const binding of input.bindings)
      if (binding.reservation) sourceIds.add(binding.reservation.reservedFirstPublicationId);
    const allocated = new Set<string>();
    for (const source of selected) {
      const destination = this.require(source.identity);
      for (const id of [destination.workTypeId, destination.reservedFirstPublicationId]) {
        if (sourceIds.has(id) || allocated.has(id))
          throw new BlueprintError(
            'blueprint_invalid',
            'Destination identities must be distinct independent copies.',
          );
        allocated.add(id);
      }
    }
  }
  /** Require one caller-reserved destination pair for this exact checked source. */
  require(source: CopySourceIdentity): ReservedCopyDestination {
    const value = this.values.get(copyIdentityKey(source));
    if (!value)
      throw new BlueprintError(
        'blueprint_invalid',
        'Missing caller-reserved destination identity.',
      );
    return value;
  }
}
/** Keep explicit, caller-authorized destination offerings; never inherit a source team. */
export function prospectiveOfferingTeams(
  input: TemplateCopySourcesInput,
  source: CopySourceIdentity,
): readonly TeamId[] {
  const choices =
    input.offeringChoices?.filter(
      (choice) => copyIdentityKey(choice.source) === copyIdentityKey(source),
    ) ?? [];
  if (choices.length > 1)
    throw new BlueprintError('blueprint_invalid', 'Duplicate destination offering choice.');
  return [...new Set(choices[0]?.teamIds.map((id) => TeamId.parse(id)) ?? [])].sort();
}
