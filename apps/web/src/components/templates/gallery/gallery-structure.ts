import type {
  WorkTemplateGalleryDetail,
  WorkTemplateGalleryPreview,
} from '@docket/work/template-gallery-contract';
import type { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import type { BlueprintStep } from '@docket/work/work-template-blueprint';
import {
  blueprintOutlineNodes,
  blueprintStepName,
  type BlueprintOutlineNode,
} from '../work-template-blueprint-edit';
import { blueprintStepTiming } from '../work-template-blueprint-timing';

/** Honest released source facts used only to read a catalog outline. */
export type GalleryStructureSource = Pick<WorkTemplateGalleryDetail, 'identity' | 'definition'>;
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
function referenceSource(
  step: BlueprintStep,
  sources: readonly GalleryStructureSource[],
): GalleryStructureSource | undefined {
  const reference = step.template;
  if (!reference) return undefined;
  const matches = sources.filter(
    ({ identity }) =>
      identity.workTypeId === reference.workTypeId &&
      (reference.selection.kind === 'latest' ||
        String(identity.catalogVersionId) === String(reference.selection.workTypeVersionId)),
  );
  if (matches.length !== 1) throw new Error('Catalog reference does not resolve exactly.');
  return matches[0];
}
function outline(
  definition: WorkTemplateDefinition,
  sources: readonly GalleryStructureSource[],
  prefix: string,
  active: ReadonlySet<string>,
): GalleryStructureNode[] {
  function project(node: BlueprintOutlineNode): GalleryStructureNode {
    const { step } = node;
    const source = referenceSource(step, sources);
    const sourceKey = source?.identity.catalogVersionId;
    if (sourceKey && active.has(sourceKey)) throw new Error('Catalog structure contains a cycle.');
    const next = new Set(active);
    if (sourceKey) next.add(sourceKey);
    const key = `${prefix}/${step.key}`;
    const timing = blueprintStepTiming(
      step,
      definition.blueprint,
      definition.name,
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
        ...(source ? outline(source.definition, sources, key, next) : []),
        ...node.children.map(project),
      ],
    };
  }
  return blueprintOutlineNodes(definition.blueprint).map(project);
}
/**
 * Expand actual catalog references and semantic children without pretending they are workspace versions.
 * @throws When an exact referenced source is absent, cyclic or exceeds the ordinary work boundary.
 */
export function galleryStructure(
  definition: WorkTemplateDefinition,
  sources: readonly GalleryStructureSource[],
): readonly GalleryStructureNode[] {
  const result = outline(definition, sources, 'root', new Set());
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
/** Adapt an actual reviewed copy vector for the same read-only catalog-source renderer. */
export function galleryPreviewSources(
  preview: WorkTemplateGalleryPreview,
): readonly GalleryStructureSource[] {
  return preview.copies.map((copy) => ({ identity: copy.source, definition: copy.definition }));
}
