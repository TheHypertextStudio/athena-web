import type { TemplateCopyReview, TemplateCopyReferenceBinding } from './gallery-review-types';
import { copyIdentityKey, type CopySourceIdentity } from '@docket/work/template-copy';
import type { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import type { BlueprintStep } from '@docket/work/work-template-blueprint';
import {
  blueprintOutlineNodes,
  blueprintStepName,
  type BlueprintOutlineNode,
} from '../work-template-blueprint-edit';
import { blueprintStepTiming } from '../work-template-blueprint-timing';

/** Actual authorized source facts for the shared read-only copy outline. */
export interface GalleryStructureSource {
  readonly identity: CopySourceIdentity;
  readonly definition: WorkTemplateDefinition;
  readonly referenceBindings?: readonly TemplateCopyReferenceBinding[] | undefined;
}
/** Read-only work hierarchy; keys identify display occurrences, never fabricated publications. */
export interface GalleryStructureNode {
  readonly key: string;
  readonly name: string;
  readonly kind: BlueprintStep['kind'];
  readonly document: string;
  readonly timing: string | null;
  readonly optional: boolean;
  readonly children: readonly GalleryStructureNode[];
}
function sourceVersion(identity: CopySourceIdentity): string | null {
  if (identity.kind === 'catalog') return identity.catalogVersionId;
  return identity.kind === 'publication' ? identity.workTypeVersionId : null;
}
/** Actual source and authored slot whose resolved target was checked by the server. */
export interface GalleryReferenceContext {
  readonly owner: CopySourceIdentity;
  readonly slot: TemplateCopyReferenceBinding['slot'];
}
function checkedTarget(
  sources: readonly GalleryStructureSource[],
  context?: GalleryReferenceContext,
): CopySourceIdentity | undefined {
  if (!context) return undefined;
  const owner = sources.find(
    (source) => copyIdentityKey(source.identity) === copyIdentityKey(context.owner),
  );
  if (!owner) throw new Error('Template owner does not resolve exactly.');
  if (!owner.referenceBindings) return undefined;
  const binding = owner.referenceBindings.find(
    (value) => value.slot.kind === context.slot.kind && value.slot.key === context.slot.key,
  );
  if (!binding) throw new Error('Template slot does not resolve exactly.');
  return binding.target;
}
/** Resolve the actual checked slot, or a unique catalog reference; never infer latest from version ordering. */
export function galleryReferenceSource(
  reference: NonNullable<BlueprintStep['template']>,
  sources: readonly GalleryStructureSource[],
  context?: GalleryReferenceContext,
): GalleryStructureSource {
  const target = checkedTarget(sources, context);
  const matches = sources.filter(({ identity }) =>
    target
      ? copyIdentityKey(identity) === copyIdentityKey(target) &&
        identity.workTypeId === reference.workTypeId
      : identity.workTypeId === reference.workTypeId &&
        (reference.selection.kind === 'latest' ||
          sourceVersion(identity) === reference.selection.workTypeVersionId),
  );
  const source = matches[0];
  if (matches.length !== 1 || !source)
    throw new Error('Template reference does not resolve exactly.');
  return source;
}
interface OutlineContext {
  readonly prefix: string;
  readonly active: ReadonlySet<string>;
  readonly parentName: string;
  readonly owner: CopySourceIdentity | undefined;
}
function outline(
  definition: WorkTemplateDefinition,
  sources: readonly GalleryStructureSource[],
  context: OutlineContext,
): GalleryStructureNode[] {
  const { prefix, active, parentName, owner } = context;
  function project(node: BlueprintOutlineNode): GalleryStructureNode {
    const { step } = node;
    const source = step.template
      ? galleryReferenceSource(
          step.template,
          sources,
          owner ? { owner, slot: { kind: 'blueprint_step', key: step.key } } : undefined,
        )
      : undefined;
    const sourceKey = source ? copyIdentityKey(source.identity) : null;
    if (sourceKey && active.has(sourceKey)) throw new Error('Catalog structure contains a cycle.');
    const next = new Set(active);
    if (sourceKey) next.add(sourceKey);
    const key = `${prefix}/${step.key}`;
    const timing = blueprintStepTiming(
      step,
      definition.blueprint,
      parentName,
      definition.payload.targetType,
    );
    return {
      key,
      name: blueprintStepName(step),
      kind: step.kind,
      document: step.fields.description ?? source?.definition.payload.description ?? '',
      timing: timing === 'No dates set' ? null : timing,
      optional: step.optional.enabled,
      children: [
        ...(source
          ? outline(source.definition, sources, {
              prefix: key,
              active: next,
              parentName: blueprintStepName(step),
              owner: source.identity,
            })
          : []),
        ...node.children.map(project),
      ],
    };
  }
  return blueprintOutlineNodes(definition.blueprint).map(project);
}
/**
 * Expand exact checked catalog, saved draft and publication references without fabricated versions.
 * @throws When an exact referenced source is absent, cyclic or exceeds the ordinary work boundary.
 */
export function galleryStructure(
  definition: WorkTemplateDefinition,
  sources: readonly GalleryStructureSource[],
  identity?: CopySourceIdentity,
): readonly GalleryStructureNode[] {
  const owner = identity ?? sources.find((source) => source.definition === definition)?.identity;
  const result = outline(definition, sources, {
    prefix: 'root',
    active: new Set<string>(),
    parentName: definition.name,
    owner,
  });
  let count = 1;
  function visit(nodes: readonly GalleryStructureNode[]): void {
    for (const node of nodes) {
      count++;
      visit(node.children);
    }
  }
  visit(result);
  if (count > 500) throw new Error('Catalog structure exceeds the work boundary.');
  return result;
}
/** Adapt actual checked sources for the shared read-only copy renderer. */
export function galleryPreviewSources(
  preview: TemplateCopyReview,
): readonly GalleryStructureSource[] {
  return preview.copies.map((copy) => ({
    identity: copy.source,
    definition: copy.definition,
    referenceBindings: copy.referenceBindings,
  }));
}
