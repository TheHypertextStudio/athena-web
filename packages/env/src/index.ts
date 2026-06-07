/**
 * `@docket/env` — validated, fail-fast environment slices.
 *
 * @remarks
 * Import the per-surface composition you need from its subpath — `@docket/env/api`
 * (server), `@docket/env/web` / `/marketing` / `/admin` (Next.js client). This root
 * barrel deliberately does NOT import a composition (that would trigger fail-fast
 * validation on any import); it only re-exports the var registry + helpers used by
 * tooling (`scripts/env-check.ts`) and the boundary resolver.
 */
export type { Scope, Slice, Target, VarSpec } from './registry';
export { findVar, VAR_REGISTRY } from './registry';

/** The deploy modes; `local`/`test` force the mock boundary adapters (boundaries.md). */
export type AppMode = 'local' | 'test' | 'production';

/**
 * Whether a given env value should be treated as a real credential or a placeholder
 * that selects a mock adapter. A value is "real" when present and not an obvious
 * placeholder (empty, or a `...`/`changeme`/`placeholder` sentinel).
 */
export function isRealValue(value: string | undefined | null): value is string {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  if (v.length === 0) return false;
  return !(
    v.endsWith('...') ||
    v.includes('placeholder') ||
    v.includes('changeme') ||
    v.includes('change-me') ||
    v.includes('your-') ||
    v === 'mock'
  );
}
