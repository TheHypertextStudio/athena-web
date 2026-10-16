import { copyFacts } from './copy-facts';
export { copyFacts } from './copy-facts';
import { OrganizationId } from '@docket/identity-access/ids';
import { WorkTypeId, WorkTypeVersionId } from '../ids';
import { BlueprintError } from '../blueprints/errors';
import type { PublishedBlueprintSnapshot } from '../blueprints/types';
import { normalizeCopyDefinition } from './copy-normalize';
import type { BlueprintStep } from '../contracts/work-template-blueprint';
import type { CopySourceRef, CopySourceSnapshot, TemplateCopyInput } from './copy-types';

/** Stable exact source pair key; input order never determines a chosen publication. */
export function copySourceKey(ref: CopySourceRef): string {
  return `${WorkTypeId.parse(ref.workTypeId)}:${WorkTypeVersionId.parse(ref.versionId)}`;
}
/** Project only the exact source pair; warning records never contain source bodies or metadata. */
export function copySourceRef(ref: CopySourceRef): CopySourceRef {
  return {
    workTypeId: WorkTypeId.parse(ref.workTypeId),
    versionId: WorkTypeVersionId.parse(ref.versionId),
  };
}
function normalizeSource(source: CopySourceSnapshot): CopySourceSnapshot {
  const normalized = normalizeCopyDefinition(source.snapshot.definition, source.defaultSchedules);
  copySourceKey(source.snapshot);
  OrganizationId.parse(source.snapshot.organizationId);
  if (source.snapshot.kind !== normalized.payload.targetType || !source.fingerprint)
    throw new BlueprintError(
      'blueprint_invalid',
      'Source publication kind or fingerprint is missing.',
    );
  return {
    ...source,
    snapshot: { ...source.snapshot, definition: normalized },
    defaultSchedules: normalized.defaultSchedules,
  };
}
/** Checked immutable source lookup, including exact once-only latest choices and inline base facts. */
export class CopySourceCatalog {
  readonly sources = new Map<string, CopySourceSnapshot>();
  readonly latest = new Map<string, CopySourceRef>();
  readonly bases = new Map<PublishedBlueprintSnapshot['kind'], PublishedBlueprintSnapshot>();
  constructor(input: TemplateCopyInput) {
    for (const item of input.sources) {
      const source = normalizeSource(item),
        key = copySourceKey(source.snapshot);
      const prior = this.sources.get(key);
      if (prior && copyFacts(prior) !== copyFacts(source))
        throw new BlueprintError('blueprint_invalid', 'Conflicting duplicate source publication.');
      this.sources.set(key, source);
    }
    for (const ref of input.latest) {
      const prior = this.latest.get(ref.workTypeId);
      if (prior && prior.versionId !== ref.versionId)
        throw new BlueprintError('blueprint_invalid', 'Ambiguous frozen latest publication.');
      this.require(ref);
      this.latest.set(ref.workTypeId, ref);
    }
    for (const base of input.bases) {
      if (this.bases.has(base.kind))
        throw new BlueprintError('blueprint_invalid', 'Ambiguous inline base publication.');
      this.bases.set(
        base.kind,
        normalizeSource({ snapshot: base, fingerprint: 'checked-base' }).snapshot,
      );
    }
  }
  /** Require an exact checked source; an identifier alone is never resolved by array order. */
  require(ref: CopySourceRef): CopySourceSnapshot {
    const source = this.sources.get(copySourceKey(ref));
    if (!source) throw new BlueprintError('blueprint_invalid', 'Missing exact source publication.');
    return source;
  }
  /** Resolve a reusable explicit reference using its exact pin or caller-frozen latest pair. */
  resolve(reference: NonNullable<BlueprintStep['template']>): CopySourceSnapshot {
    const ref =
      reference.selection.kind === 'pinned'
        ? { workTypeId: reference.workTypeId, versionId: reference.selection.workTypeVersionId }
        : this.latest.get(reference.workTypeId);
    if (!ref) throw new BlueprintError('blueprint_invalid', 'Missing frozen latest publication.');
    return this.require(ref);
  }
}
