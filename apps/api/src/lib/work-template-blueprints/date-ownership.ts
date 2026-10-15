import type { BlueprintDateBindings } from '@docket/work/work-template-blueprint';
import type { BlueprintDateField } from '@docket/work/blueprints';

const DATE_FIELDS: readonly BlueprintDateField[] = ['startDate', 'dueDate', 'targetDate'];
/** Explicit writes, including same value and null, own only that accepted managed field. */
export function explicitBlueprintDatePatch(
  row: { readonly blueprintDateBindings: BlueprintDateBindings },
  request: Readonly<Record<string, unknown>>,
): { readonly blueprintDateBindings?: BlueprintDateBindings } {
  let changed = false;
  const bindings = { ...row.blueprintDateBindings };
  for (const field of DATE_FIELDS) {
    const binding = bindings[field];
    if (request[field] === undefined || !binding || binding.manual) continue;
    bindings[field] = { ...binding, manual: true };
    changed = true;
  }
  return changed ? { blueprintDateBindings: bindings } : {};
}
/** True only for an explicit ordinary date or workflow transition, excluding unrelated edits. */
export function requestsBlueprintReflow(request: Readonly<Record<string, unknown>>): boolean {
  return [...DATE_FIELDS, 'state', 'status'].some((field) => request[field] !== undefined);
}
