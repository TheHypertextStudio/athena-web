import { WorkTypeId } from '@docket/work/ids';
import { workTemplateHref } from './work-template-navigation';

/** Validate same-workspace parent navigation context; the destination's normal read authorizes access. */
export function workTemplateReturnHref(
  orgId: string,
  currentId: string | null,
  candidate: string | null,
): string | null {
  const parent = WorkTypeId.safeParse(candidate);
  return parent.success && parent.data !== currentId
    ? `${workTemplateHref(orgId)}/${parent.data}?section=review`
    : null;
}
