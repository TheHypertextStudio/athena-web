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
import type { Target } from './registry-types';
import { INFRA_VARS } from './registry-vars-infra';
import { SERVICE_VARS } from './registry-vars-services';

export type { Scope, Slice, Target, VarSpec } from './registry-types';

/** The single declaration of every environment variable Docket reads. */
export const VAR_REGISTRY = [...CORE_VARS, ...SERVICE_VARS, ...INFRA_VARS] as const;

/** Look up a single var spec by name. */
export function findVar(name: string) {
  return VAR_REGISTRY.find((v) => v.name === name);
}

/** One variable that fails the contract, with the hint that explains how to satisfy it. */
export interface EnvIssue {
  /** The variable name. */
  readonly name: string;
  /** The registry's `where` hint, or a note for a variable that has no spec. */
  readonly where: string;
  /** Why it failed, in a form safe to print: never the value itself. */
  readonly reason: string;
}

/**
 * Check an environment against the contract for one surface.
 *
 * @remarks
 * `VAR_REGISTRY` already records which targets each variable belongs to, but nothing queried it
 * that way, so every caller re-derived the filter and none agreed. This is that query, so a local
 * `env:check`, the env-file parity tests, and the deploy-manifest gate all read the same
 * declaration rather than three drifting copies of it.
 *
 * Values are parsed with the variable's own zod schema — the same one the app boots against — so a
 * present-but-malformed value is a failure here rather than a container that exits at startup.
 * Absent optional variables are not failures; absent required ones are.
 *
 * @param target - The surface being checked (`api`, `web`, `marketing`, `admin`).
 * @param env - The environment to check. An empty string counts as absent, matching
 * `emptyStringAsUndefined` in the app compositions and the shape CI writes for an unset variable.
 * @param options - `rejectUnknown` additionally reports any variable in `env` that the registry
 * does not declare for this target. Reserve it for a closed set like a generated deploy manifest;
 * a process environment legitimately carries thousands of unrelated variables.
 * @returns every issue found, in registry order, so a caller can report all of them at once.
 */
export function checkEnvForTarget(
  target: Target,
  env: Readonly<Record<string, string | undefined>>,
  options: { readonly rejectUnknown?: boolean } = {},
): EnvIssue[] {
  const specs = VAR_REGISTRY.filter((spec) => spec.targets.includes(target));
  const issues: EnvIssue[] = [];

  for (const spec of specs) {
    const raw = env[spec.name];
    if (raw === undefined || raw === '') {
      if (spec.required) {
        issues.push({ name: spec.name, where: spec.where, reason: 'missing (required)' });
      }
      continue;
    }
    const parsed = spec.zod.safeParse(raw);
    if (!parsed.success) {
      issues.push({
        name: spec.name,
        where: spec.where,
        reason: parsed.error.issues.map((issue) => issue.message).join('; '),
      });
    }
  }

  if (options.rejectUnknown) {
    const declared = new Set(specs.map((spec) => spec.name));
    for (const name of Object.keys(env)) {
      if (declared.has(name)) continue;
      issues.push({
        name,
        // Deliberately not an allowlist: a variable worth deploying is a variable worth declaring,
        // and a second place to record that would be the drift this contract exists to prevent.
        where: `not declared for target "${target}" — add it to VAR_REGISTRY, or stop setting it`,
        reason: 'unknown variable',
      });
    }
  }

  return issues;
}
