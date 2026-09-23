/**
 * Test support: call a write helper the way its production entry point does.
 *
 * @remarks
 * A change recorded outside any provenance scope throws, by design. Tests that call a write helper
 * directly, rather than through the route, job, or tool that owns it, declare the same provenance
 * that entry point declares.
 */
import {
  integrationProvenance,
  type ProvenanceBase,
  runWithProvenance,
} from '../../src/lib/provenance/context';

/**
 * The provenance a sync pass declares, for tests that drive a reconciler without the pass.
 *
 * @param provider - The connected tool.
 * @returns the `sync` provenance.
 */
export function syncPass(provider: string): ProvenanceBase {
  return integrationProvenance('sync', { id: 'integration_under_test', provider });
}

/**
 * Wrap a function so every call runs under one provenance.
 *
 * @param base - The provenance the real entry point declares.
 * @param fn - The helper under test.
 * @returns the wrapped helper.
 */
export function scoped<A extends unknown[], R>(
  base: ProvenanceBase,
  fn: (...args: A) => R,
): (...args: A) => R {
  return (...args) => runWithProvenance(base, () => fn(...args));
}
