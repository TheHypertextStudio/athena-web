import { WorkTemplateCopyReceipt } from '@docket/work/template-gallery-contract';
import { WorkTypeId } from '@docket/work/ids';
import { workTemplateHref } from './work-template-navigation';

/** Validate same-workspace parent navigation context; the destination's normal read authorizes access. */
export function workTemplateReturnHref(
  orgId: string,
  currentId: string | null,
  candidate: string | null,
  context?: string | null,
  destination?:
    string | null | { readonly bundle?: string | null; readonly proposal?: string | null },
): string | null {
  const bundleCandidate = typeof destination === 'object' ? destination?.bundle : destination;
  const proposal = WorkTypeId.safeParse(
    typeof destination === 'object' ? destination?.proposal : null,
  );
  const parent = WorkTypeId.safeParse(candidate);
  if (!parent.success || parent.data === currentId) {
    if (context === 'proposal' && proposal.success)
      return workTemplateHref(orgId, `/review/${proposal.data}`);
    const bundle = WorkTemplateCopyReceipt.shape.bundleId.safeParse(bundleCandidate);
    return bundle.success ? workTemplateHref(orgId, `/gallery/copies/${bundle.data}`) : null;
  }
  const params = restoredParentContext(parent.data, context);
  return `${workTemplateHref(orgId)}/${parent.data}?${params.toString()}`;
}

function restoredParentContext(parentId: string, context?: string | null): URLSearchParams {
  const params = new URLSearchParams({ section: 'review' });
  if (!context || context.length >= 8000) return params;
  const previous = new URLSearchParams(context);
  if (previous.get('mode') === 'create') {
    params.set('mode', 'create');
    const reached = previous.get('reached');
    if (reached && /^[0-3]$/.test(reached)) params.set('reached', reached);
  }
  const ancestor = WorkTypeId.safeParse(previous.get('returnTo'));
  if (ancestor.success && ancestor.data !== parentId) params.set('returnTo', ancestor.data);
  const bundle = WorkTemplateCopyReceipt.shape.bundleId.safeParse(previous.get('returnBundle'));
  if (bundle.success) params.set('returnBundle', bundle.data);
  const priorProposal = WorkTypeId.safeParse(previous.get('returnProposal'));
  if (priorProposal.success) params.set('returnProposal', priorProposal.data);
  const nested = previous.get('returnContext');
  if (nested) params.set('returnContext', nested);

  return params;
}
