import type {
  BlueprintDifference,
  ExistingBlueprintNode,
  PlannedWorkNode,
} from '@docket/work/blueprints';
import { WorkTemplateChildChange } from '@docket/work/work-template-reference';

function title(node: ExistingBlueprintNode | PlannedWorkNode | undefined): string {
  const fields = node?.fields;
  if (fields && 'title' in fields && fields.title) return fields.title.slice(0, 256);
  if (fields && 'name' in fields && fields.name) return fields.name.slice(0, 256);
  return '';
}
function atPath(
  nodes: readonly (ExistingBlueprintNode | PlannedWorkNode)[],
  path: readonly string[],
) {
  return nodes.find((node) => JSON.stringify(node.path) === JSON.stringify(path));
}
/** Project authorized differences into bounded display choices, never prepared inserts or private bodies. */
export function selectiveChangeSummaries(
  differences: readonly BlueprintDifference[],
  current: readonly ExistingBlueprintNode[],
  planned: readonly PlannedWorkNode[],
  selectedSubtree: (
    change: Extract<BlueprintDifference, { kind: 'add_child' }>,
  ) => ReadonlySet<string>,
): WorkTemplateChildChange[] {
  return differences.map((difference) => {
    if (difference.kind === 'add_child') {
      const selected = selectedSubtree(difference);
      return WorkTemplateChildChange.parse({
        changeId: difference.changeId,
        kind: difference.kind,
        path: difference.path,
        count: difference.nodes.filter((node) => selected.has(JSON.stringify(node.path))).length,
        selectedByDefault: difference.selectedByDefault,
        children: difference.nodes.map((node) => ({
          path: node.path,
          parentPath: node.parentPath ?? [],
          kind: node.kind,
          title: title(node),
          workTypeId: node.workTypeId,
          workTypeVersionId: node.workTypeVersionId,
          dates: node.dates,
          unresolvedReasons: node.unresolvedReasons,
          optional: node.step?.optional.enabled ?? false,
          selectedByDefault: node.step?.optional.selectedByDefault ?? true,
          selected: selected.has(JSON.stringify(node.path)),
          prerequisites: node.prerequisitePaths,
        })),
      });
    }
    if (difference.kind === 'set_derived_date')
      return WorkTemplateChildChange.parse({
        changeId: difference.changeId,
        kind: difference.kind,
        path: difference.path,
        title: title(current.find((node) => node.id === difference.id)),
        field: difference.field,
        previous: difference.previous,
        value: difference.value,
        rule: difference.rule,
        selectedByDefault: false,
      });
    if (difference.kind === 'cancel_removed_child')
      return WorkTemplateChildChange.parse({
        changeId: difference.changeId,
        kind: difference.kind,
        path: difference.path,
        title: title(current.find((node) => node.id === difference.id)),
        selectedByDefault: false,
      });
    return WorkTemplateChildChange.parse({
      ...difference,
      blockerTitle: title(atPath([...current, ...planned], difference.blockerPath)),
      blockedTitle: title(atPath([...current, ...planned], difference.blockedPath)),
    });
  });
}
