import { z } from 'zod';
import { OrganizationId } from '@docket/identity-access/ids';
import { WorkTypeId, WorkTypeVersionId } from '../ids';
import { BlueprintError } from '../blueprints/errors';
import { StepKey } from '../contracts/work-template-blueprint';
import type { BlueprintStep } from '../contracts/work-template-blueprint';
import { CopySourceIdentity, copyIdentityKey, copyIdentityScope } from './copy-identity';
import { copyFacts } from './copy-facts';
import { normalizeCopyDefinition } from './copy-normalize';
import type {
  CopyDefinitionSource,
  CopyReferenceBinding,
  CopyReferenceSlot,
  TemplateCopySourcesInput,
} from './copy-prospective-types';

/** Authored explicit reference, including an independent default schedule. */
export interface CopyAuthoredReference {
  readonly slot: CopyReferenceSlot;
  readonly kind: CopyDefinitionSource['kind'] | 'milestone';
  readonly reference: NonNullable<BlueprintStep['template']>;
}
const reservation = z.strictObject({
  organizationId: OrganizationId,
  workTypeId: WorkTypeId,
  reservedFirstPublicationId: WorkTypeVersionId,
  draftRevision: z.number().int().nonnegative(),
  draftFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});
const bindingSchema = z.strictObject({
  source: CopySourceIdentity,
  slot: z.strictObject({ kind: z.enum(['blueprint_step', 'default_schedule']), key: StepKey }),
  target: CopySourceIdentity,
  reservation: reservation.optional(),
});
/** Enumerate only authored template/default-schedule references; inline work has no source dependency. */
export function authoredCopyReferences(
  source: Pick<CopyDefinitionSource, 'definition'>,
): CopyAuthoredReference[] {
  return [
    ...source.definition.blueprint.steps.flatMap((step) =>
      step.template
        ? [
            {
              slot: { kind: 'blueprint_step' as const, key: step.key },
              kind: step.kind,
              reference: step.template,
            },
          ]
        : [],
    ),
    ...source.definition.defaultSchedules.map((schedule) => ({
      slot: { kind: 'default_schedule' as const, key: schedule.key },
      kind: schedule.template.targetType,
      reference: schedule.template,
    })),
  ];
}
function slotKey(source: CopySourceIdentity, slot: CopyReferenceSlot): string {
  return JSON.stringify([copyIdentityKey(source), slot.kind, StepKey.parse(slot.key)]);
}
function normalized(source: CopyDefinitionSource): CopyDefinitionSource {
  const identity = CopySourceIdentity.parse(source.identity);
  const definition = normalizeCopyDefinition(source.definition, source.defaultSchedules);
  if (source.kind !== definition.payload.targetType || !source.fingerprint)
    throw new BlueprintError('blueprint_invalid', 'Source kind or fingerprint is missing.');
  if (identity.kind === 'draft' && identity.draftFingerprint !== source.fingerprint)
    throw new BlueprintError(
      'blueprint_invalid',
      'Draft fingerprint differs from its exact source.',
    );
  if (source.archived && identity.kind !== 'publication')
    throw new BlueprintError(
      'blueprint_invalid',
      'Only an exact publication can be an archived copy source.',
    );
  return { ...source, identity, definition, defaultSchedules: definition.defaultSchedules };
}
function matchesSelection(
  owner: CopyDefinitionSource,
  target: CopyDefinitionSource,
  authored: CopyAuthoredReference,
  binding: CopyReferenceBinding,
): void {
  const { reference } = authored;
  if (
    copyIdentityScope(owner.identity) !== copyIdentityScope(target.identity) ||
    target.kind !== authored.kind ||
    reference.workTypeId !== target.identity.workTypeId
  )
    throw new BlueprintError(
      'blueprint_invalid',
      'Copy dependency namespace, workspace or kind does not match its source.',
    );
  if (owner.identity.kind === 'publication' && target.identity.kind !== 'publication')
    throw new BlueprintError(
      'blueprint_invalid',
      'Published references require actual publications.',
    );
  if (owner.identity.kind === 'catalog') {
    matchCatalog(target, authored, binding);
    return;
  }
  if (target.identity.kind === 'draft') {
    matchReservedDraft(target.identity, authored, binding);
    return;
  }
  matchPublication(target, authored, binding);
}
function matchPublication(
  target: CopyDefinitionSource,
  authored: CopyAuthoredReference,
  binding: CopyReferenceBinding,
): void {
  const { reference } = authored;
  if (target.identity.kind !== 'publication' || binding.reservation)
    throw new BlueprintError(
      'blueprint_invalid',
      'Unexpected copy reservation or source namespace.',
    );
  if (reference.selection.kind === 'latest') {
    if (target.archived)
      throw new BlueprintError(
        'blueprint_invalid',
        'Archived sources cannot resolve latest selection.',
      );
  } else if (reference.selection.workTypeVersionId !== target.identity.workTypeVersionId)
    throw new BlueprintError(
      'blueprint_invalid',
      'Resolved publication differs from authored pin.',
    );
}
function matchCatalog(
  target: CopyDefinitionSource,
  authored: CopyAuthoredReference,
  binding: CopyReferenceBinding,
): void {
  if (
    target.identity.kind !== 'catalog' ||
    binding.reservation ||
    authored.reference.selection.kind !== 'pinned' ||
    authored.reference.selection.workTypeVersionId !== String(target.identity.catalogVersionId)
  )
    throw new BlueprintError(
      'blueprint_invalid',
      'Catalog references require exact same-release catalog pins.',
    );
}
function matchReservedDraft(
  target: Extract<CopySourceIdentity, { kind: 'draft' }>,
  authored: CopyAuthoredReference,
  binding: CopyReferenceBinding,
): void {
  const saved = binding.reservation;
  if (
    !saved ||
    authored.reference.selection.kind !== 'pinned' ||
    saved.organizationId !== target.organizationId ||
    saved.workTypeId !== target.workTypeId ||
    saved.draftRevision !== target.draftRevision ||
    saved.draftFingerprint !== target.draftFingerprint ||
    authored.reference.selection.workTypeVersionId !== saved.reservedFirstPublicationId
  )
    throw new BlueprintError(
      'blueprint_invalid',
      'Private draft pins require an exact checked current reservation.',
    );
}
/** Frozen honest source lookup; normalization validates reference bindings, never grants source visibility. */
export class ProspectiveCopyCatalog {
  readonly sources = new Map<string, CopyDefinitionSource>();
  readonly bindings = new Map<string, CopyReferenceBinding>();
  constructor(input: TemplateCopySourcesInput) {
    OrganizationId.parse(input.destinationOrganizationId);
    for (const raw of input.sources) {
      const source = normalized(raw),
        key = copyIdentityKey(source.identity),
        previous = this.sources.get(key);
      if (previous && copyFacts(previous) !== copyFacts(source))
        throw new BlueprintError('blueprint_invalid', 'Conflicting duplicate exact source facts.');
      this.sources.set(key, source);
    }
    for (const raw of input.bindings) {
      const { reservation, ...binding } = bindingSchema.parse(raw);
      this.addBinding(reservation ? { ...binding, reservation } : binding);
    }
    this.assertFrozenSelections();
  }
  private addBinding(binding: CopyReferenceBinding): void {
    const owner = this.require(binding.source),
      target = this.require(binding.target);
    const authored = authoredCopyReferences(owner).find(
      (entry) => entry.slot.kind === binding.slot.kind && entry.slot.key === binding.slot.key,
    );
    if (!authored)
      throw new BlueprintError('blueprint_invalid', 'Unknown authored copy reference slot.');
    matchesSelection(owner, target, authored, binding);
    const key = slotKey(binding.source, binding.slot),
      previous = this.bindings.get(key);
    if (previous && copyFacts(previous) !== copyFacts(binding))
      throw new BlueprintError('blueprint_invalid', 'Conflicting exact reference bindings.');
    this.bindings.set(key, binding);
  }
  private assertFrozenSelections(): void {
    const latest = new Map<string, string>(),
      reservations = new Map<string, string>();
    for (const binding of this.bindings.values()) {
      const owner = this.require(binding.source);
      const authored = authoredCopyReferences(owner).find(
        (entry) => entry.slot.kind === binding.slot.kind && entry.slot.key === binding.slot.key,
      );
      const key = `${copyIdentityScope(owner.identity)}:${binding.target.workTypeId}`;
      if (authored?.reference.selection.kind === 'latest')
        this.assertUnique(
          latest,
          key,
          copyIdentityKey(binding.target),
          'Ambiguous frozen latest publication.',
        );
      if (binding.reservation)
        this.assertUnique(
          reservations,
          `${binding.reservation.organizationId}:${binding.reservation.reservedFirstPublicationId}`,
          copyIdentityKey(binding.target),
          'Conflicting current draft reservation.',
        );
    }
  }
  private assertUnique(
    values: Map<string, string>,
    key: string,
    value: string,
    message: string,
  ): void {
    const previous = values.get(key);
    if (previous && previous !== value) throw new BlueprintError('blueprint_invalid', message);
    values.set(key, value);
  }
  /** Require one exact authorized source identity; unknown IDs cannot resolve by input order. */
  require(identity: CopySourceIdentity): CopyDefinitionSource {
    const source = this.sources.get(copyIdentityKey(identity));
    if (!source) throw new BlueprintError('blueprint_invalid', 'Missing exact source definition.');
    return source;
  }
  /** Resolve the exact checked target of an authored owner-qualified slot. */
  resolve(source: CopyDefinitionSource, slot: CopyReferenceSlot): CopyDefinitionSource {
    const binding = this.bindings.get(slotKey(source.identity, slot));
    if (!binding)
      throw new BlueprintError('blueprint_invalid', 'Missing exact authored reference binding.');
    return this.require(binding.target);
  }
}
