import type { WorkTemplateDisplay } from '@docket/work/work-template-reference';

/** Use the workspace noun for its base type and preserve every user-authored type name. */
export function workTypeDisplayName(
  definition: Pick<WorkTemplateDisplay, 'name' | 'isBase'>,
  familyName: string,
): string {
  return definition.isBase ? familyName : definition.name;
}
