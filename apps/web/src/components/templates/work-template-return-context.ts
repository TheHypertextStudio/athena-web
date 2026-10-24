import { WorkTypeId } from '@docket/work/ids';
import { workTemplateHref } from './work-template-navigation';

/** Validate same-workspace parent navigation context; the destination's normal read authorizes access. */
export function workTemplateReturnHref(
  orgId: string,
  currentId: string | null,
  candidate: string | null,
  context?: string | null,
): string | null {
  const parent = WorkTypeId.safeParse(candidate);
  if (!parent.success || parent.data === currentId) return null;
  const params = new URLSearchParams({ section: 'review' });
  if (context && context.length < 8000) {
    const previous = new URLSearchParams(context);
    if (previous.get('mode') === 'create') {
      params.set('mode', 'create');
      const reached = previous.get('reached');
      if (reached && /^[0-3]$/.test(reached)) params.set('reached', reached);
    }
    const ancestor = WorkTypeId.safeParse(previous.get('returnTo'));
    if (ancestor.success && ancestor.data !== parent.data) params.set('returnTo', ancestor.data);
    const nested = previous.get('returnContext');
    if (nested) params.set('returnContext', nested);
  }
  return `${workTemplateHref(orgId)}/${parent.data}?${params.toString()}`;
}
