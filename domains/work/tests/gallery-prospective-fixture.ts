import { OrganizationId } from '@docket/identity-access/ids';
import { WorkTypeId, WorkTypeVersionId } from '../src/ids';
import { WorkTemplateDefinition } from '../src/contracts/work-template';
import type { BlueprintStep } from '../src/contracts/work-template-blueprint';
import type { WorkKind } from '../src/blueprints/types';
import { CopySourceIdentity } from '../src/gallery/copy-identity';
import type {
  CopyDefinitionSource,
  CopyReferenceBinding,
  ReservedCopyDestination,
  TemplateCopySourcesInput,
} from '../src/gallery/copy-prospective-types';
import { ulid } from './blueprint-fixtures';
export const sourceOrganizationId = OrganizationId.parse(ulid(1));
export const targetOrganizationId = OrganizationId.parse(ulid(800));
/** Honest draft facts with no publication/projection identity. */
export function prospectiveSource(
  n: number,
  kind: WorkKind = 'task',
  steps: BlueprintStep[] = [],
  sourceKind: 'draft' | 'publication' | 'catalog' = 'draft',
): CopyDefinitionSource {
  const fingerprint = `sha256:${n.toString(16).padStart(64, '0')}`;
  const common = { workTypeId: WorkTypeId.parse(ulid(n)) };
  const identity = CopySourceIdentity.parse(
    sourceKind === 'draft'
      ? {
          kind: 'draft',
          ...common,
          organizationId: sourceOrganizationId,
          draftRevision: 0,
          draftFingerprint: fingerprint,
        }
      : sourceKind === 'publication'
        ? {
            kind: 'publication',
            ...common,
            organizationId: sourceOrganizationId,
            workTypeVersionId: ulid(n + 100),
          }
        : { kind: 'catalog', ...common, release: 1, catalogVersionId: ulid(n + 100) },
  );
  return {
    identity,
    fingerprint,
    kind,
    definition: WorkTemplateDefinition.parse({
      name: `Template ${n}`,
      payload: { targetType: kind },
      blueprint: { steps, dependencies: [] },
    }),
  };
}
/** Checked owner-qualified slot with optional real persisted private reservation facts. */
export function prospectiveBinding(
  source: CopyDefinitionSource,
  target: CopyDefinitionSource,
  key = 'child',
): CopyReferenceBinding {
  return {
    source: source.identity,
    target: target.identity,
    slot: { kind: 'blueprint_step', key },
    ...(target.identity.kind === 'draft'
      ? {
          reservation: {
            organizationId: target.identity.organizationId,
            workTypeId: target.identity.workTypeId,
            reservedFirstPublicationId: WorkTypeVersionId.parse(ulid(9000)),
            draftRevision: target.identity.draftRevision,
            draftFingerprint: target.identity.draftFingerprint,
          },
        }
      : {}),
  };
}
/** Canonical authored pin, interpreted in its honest source namespace. */
export function prospectiveReference(target: CopyDefinitionSource) {
  const value = target.identity;
  return {
    workTypeId: value.workTypeId,
    selection: {
      kind: 'pinned' as const,
      workTypeVersionId: WorkTypeVersionId.parse(
        value.kind === 'draft'
          ? ulid(9000)
          : value.kind === 'catalog'
            ? value.catalogVersionId
            : value.workTypeVersionId,
      ),
    },
  };
}
/** Exact service-owned pending destination identities, never actual publication facts. */
export function prospectiveDestination(
  source: CopyDefinitionSource,
  n: number,
): ReservedCopyDestination {
  return {
    kind: 'reserved',
    source: source.identity,
    workTypeId: WorkTypeId.parse(ulid(n)),
    reservedFirstPublicationId: WorkTypeVersionId.parse(ulid(n + 100)),
  };
}
/** Validation-only source input with no destination allocation. */
export function prospectiveInput(
  sources: CopyDefinitionSource[],
  bindings: CopyReferenceBinding[] = [],
): TemplateCopySourcesInput {
  const root = sources[0];
  if (!root) throw new Error('Missing fixture root');
  return {
    destinationOrganizationId: targetOrganizationId,
    roots: [root.identity],
    sources,
    bindings,
  };
}
