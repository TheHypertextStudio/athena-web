/**
 * `@docket/env/registry` — the single typed contract of every environment variable.
 *
 * @remarks
 * `VAR_REGISTRY` is the one declaration site for the var → {slice, scope, targets,
 * required, where-hint, sensitivity} metadata. The per-app `createEnv` compositions
 * derive their *validated* shape from the slice schemas in `./slices`; this registry
 * re-references those same `ZodType`s so `pnpm env:check` and the future bootstrap
 * prompt can validate + explain each var (with its `where` hint) without importing a
 * composition (which would fail-fast on the first missing var).
 */
import { CORE_VARS } from './registry-vars-core';
import { INFRA_VARS } from './registry-vars-infra';
import { SERVICE_VARS } from './registry-vars-services';

export type { Scope, Slice, Target, VarSpec } from './registry-types';

/** The single declaration of every environment variable Docket reads. */
export const VAR_REGISTRY = [...CORE_VARS, ...SERVICE_VARS, ...INFRA_VARS] as const;

/** Look up a single var spec by name. */
export function findVar(name: string) {
  return VAR_REGISTRY.find((v) => v.name === name);
}
