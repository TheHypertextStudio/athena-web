import { WorkTemplateSelection } from '@docket/work/work-template-reference';

/** Optional identity in a composer; old saved drafts select the workspace base. */
export interface WorkTemplateDraftFields {
  workTypeId?: string | null | undefined;
  workTypeVersionId?: string | null | undefined;
}

/** Preserve an explicit published snapshot in both saved drafts and create requests. */
export function serializeWorkTemplateSelection(
  draft: WorkTemplateDraftFields,
): WorkTemplateSelection {
  return WorkTemplateSelection.parse({
    ...(draft.workTypeId ? { workTypeId: draft.workTypeId } : {}),
    ...(draft.workTypeVersionId ? { workTypeVersionId: draft.workTypeVersionId } : {}),
  });
}

/** Restore identity without replacing it with today's publication or overwriting authored prose. */
export function hydrateWorkTemplateSelection(
  draft: WorkTemplateDraftFields,
): WorkTemplateDraftFields {
  if (draft.workTypeId === undefined && draft.workTypeVersionId === undefined) return {};
  return {
    workTypeId: draft.workTypeId ?? null,
    workTypeVersionId: draft.workTypeVersionId ?? null,
  };
}
