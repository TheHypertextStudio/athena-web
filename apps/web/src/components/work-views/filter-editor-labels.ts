import type { ViewTarget } from '@docket/work/view-contract';

/** Plural target label used by the filter dialog. */
export function labelTarget(target: ViewTarget): string {
  return target === 'initiative' ? 'initiatives' : `${target}s`;
}

/** Human-readable filter operator label. */
export function operatorLabel(operator: string): string {
  const words = operator
    .replace(/-/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .toLowerCase();
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}
