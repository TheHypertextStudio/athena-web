/** Stable actionable planner refusal; adapters map codes without exposing private snapshots. */
export class BlueprintError extends Error {
  /** Create a typed pure-planner refusal with safe logical paths. */
  constructor(
    readonly code:
      | 'blueprint_limit'
      | 'blueprint_loop'
      | 'blueprint_prerequisite'
      | 'blueprint_destination_required'
      | 'blueprint_invalid'
      | 'blueprint_incomplete_capture',
    message: string,
    readonly paths: readonly (readonly string[])[] = [],
  ) {
    super(message);
    this.name = 'BlueprintError';
  }
}
/** Canonical collision-free qualified-path key. */
export function pathKey(path: readonly string[]): string {
  return JSON.stringify(path);
}
/**
 * Assert a required already-resolved snapshot fact without weakening its type.
 * @throws For invalid or ambiguous resolved snapshots, graph limits, or calendar inputs.
 */
export function requireBlueprintValue<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new BlueprintError('blueprint_invalid', 'Missing required resolved blueprint fact.');
  return value;
}
