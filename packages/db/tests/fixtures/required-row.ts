/** Require a fixture/query row so absent setup fails before a behavioral assertion. */
export function requiredRow<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Required test fixture row is missing.');
  return value;
}
