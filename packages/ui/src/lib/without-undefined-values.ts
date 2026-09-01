/**
 * Drop every key whose value is `undefined`, keeping the rest under their original (now
 * `undefined`-free) types.
 *
 * @remarks
 * For spreading an object with optional-and-possibly-`undefined` fields onto a target whose own
 * prop types do not accept an explicit `undefined` under `exactOptionalPropertyTypes`. The row-link
 * slots are the case that needs it: they must be forwarded whole — cherry-picking `href` silently
 * drops the grid's role, row index, focus handling, drag bindings, and prefetch intent, with no type
 * error to say so — but a router `Link`'s props reject the explicit `undefined`s that whole spread
 * carries.
 *
 * Shared rather than redeclared per call site: both the product's task table and the operator
 * console's row list forward the same slot to the same `Link`, and two copies of a type-level helper
 * drift in exactly the way that produces one of them accepting a value the other rejects.
 *
 * @param value - The object to strip.
 * @returns the same object without its `undefined`-valued keys.
 */
export function withoutUndefinedValues<T extends object>(
  value: T,
): { [K in keyof T]: Exclude<T[K], undefined> } {
  const result = {} as { [K in keyof T]: Exclude<T[K], undefined> };
  for (const key of Object.keys(value) as (keyof T)[]) {
    const fieldValue = value[key];
    if (fieldValue !== undefined) {
      result[key] = fieldValue as Exclude<T[typeof key], undefined>;
    }
  }
  return result;
}
