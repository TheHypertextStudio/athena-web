import type { BlueprintStep } from '@docket/work/work-template-blueprint';
import type { WorkTemplateOut } from '@docket/work/work-template-contract';

/** Match an authorized draft's real reserved first-publication ID without asserting a version exists. */
export function pendingTemplateReference(
  template: BlueprintStep['template'],
  selected: WorkTemplateOut | undefined,
): WorkTemplateOut | undefined {
  return template?.selection.kind === 'pinned' &&
    selected?.id === template.workTypeId &&
    selected.status !== 'archived' &&
    selected.latestVersion === null &&
    selected.pendingPublication?.reservedFirstVersionId === template.selection.workTypeVersionId
    ? selected
    : undefined;
}
