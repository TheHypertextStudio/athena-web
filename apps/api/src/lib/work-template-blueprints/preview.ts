import {
  BlueprintError,
  expandBlueprint,
  type ExpandedBlueprintNode,
  type PlannedWorkNode,
} from '@docket/work/blueprints';
import {
  BlueprintCreationPreview,
  type BlueprintPreviewOptions,
  type BlueprintPreviewSummary,
} from '@docket/work/work-template-blueprint';
import type { TemplateTransaction } from '../templates/persistence';
import type { OrdinaryWorkCommand } from '../work-creation/types';
import { reviewBlueprintCreation } from './preflight';

function summaryTitle(node: ExpandedBlueprintNode, planned: PlannedWorkNode | undefined): string {
  const fields = planned?.fields ?? node.step?.fields ?? node.definition?.payload;
  if (fields && 'title' in fields && fields.title) return fields.title.slice(0, 256);
  if (fields && 'name' in fields && fields.name) return fields.name.slice(0, 256);
  return '';
}

function summarize(
  node: ExpandedBlueprintNode,
  planned: PlannedWorkNode | undefined,
): BlueprintPreviewSummary {
  if (node.kind === 'initiative')
    throw new BlueprintError('blueprint_invalid', 'An Initiative cannot be a blueprint child.');
  return {
    path: [...node.path],
    parentPath: [...(node.parentPath ?? [])],
    kind: node.kind,
    title: summaryTitle(node, planned),
    workTypeId: node.workTypeId,
    workTypeVersionId: node.workTypeVersionId,
    dates: planned?.dates ?? {},
    unresolvedReasons: planned?.unresolvedReasons ?? {},
    optional: node.step?.optional.enabled ?? false,
    selectedByDefault: node.step?.optional.selectedByDefault ?? true,
    selected: node.selected,
    prerequisites: node.prerequisitePaths.map((path) => [...path]),
  };
}

/** Authorize the entire creation, then return bounded summaries without bodies or prepared writes. */
export async function previewBlueprintCreation(
  tx: TemplateTransaction,
  command: OrdinaryWorkCommand,
  options: BlueprintPreviewOptions,
  summaryOffset = 0,
): Promise<BlueprintCreationPreview> {
  const review = await reviewBlueprintCreation(tx, command, options);
  const expanded = expandBlueprint(review.graph, options.optionalChoices);
  const descendants = expanded.nodes.filter((node) => node.parentPath !== null);
  const planned = new Map(review.tree.nodes.map((node) => [JSON.stringify(node.path), node]));
  const next = summaryOffset + 499;
  return BlueprintCreationPreview.parse({
    workTypeId: review.graph.root.workTypeId,
    workTypeVersionId: review.graph.root.versionId,
    previewToken: review.previewToken,
    resolvedManifest: review.tree.manifest,
    descendants: descendants
      .slice(summaryOffset, next)
      .map((node) => summarize(node, planned.get(JSON.stringify(node.path)))),
    descendantCount: descendants.length,
    selectedCount: review.rowCount,
    additionalMilestoneCount: review.rowCount - review.tree.nodes.length,
    summaryOffset,
    nextSummaryOffset: next < descendants.length ? next : null,
    warnings: review.tree.warnings
      .slice(0, 100)
      .map((warning) => ({ ...warning, paths: warning.paths.slice(0, 100) })),
  });
}
