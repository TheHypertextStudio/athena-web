/**
 * Types for the shared Docket ESLint preset.
 *
 * @remarks
 * `index.js` is plain JavaScript so `eslint.config.js` can load it with no build step. That makes a
 * TypeScript import of it an implicit `any`, which the repo's `typecheck:repo` task rejects — and
 * the obvious workaround, a dynamic import, is barred by the migrated-contract import policy. This
 * declaration is what lets `scripts/complexity-ledger.ts` import the preset's own rule block rather
 * than restating the four complexity targets in a second place that can drift.
 *
 * Keep it in step with `index.js` by hand. Nothing generates it, and the only thing that catches
 * drift is a consumer failing to compile.
 */
import type { ConfigArray } from 'typescript-eslint';

/** The complexity limits every file without a ledger entry is held to. */
export declare const COMPLEXITY_TARGETS: Readonly<{
  complexity: number;
  'max-depth': number;
  'max-params': number;
  'sonarjs/cognitive-complexity': number;
}>;

/** The four control-flow rules, applied to every TypeScript source. */
export declare const complexityConfig: ConfigArray;

/** Per-file relaxations for complexity that predates the gate, read from `complexity-debt.json`. */
export declare const complexityDebtConfig: ConfigArray;

/** The type-aware base preset every workspace member shares. */
export declare const baseConfig: ConfigArray;

/** Data-layer enforcement for the web app's authed surfaces. */
export declare const dataLayerConfig: ConfigArray;

/** URL-reading enforcement for the trees the app-location provider covers. */
export declare const appLocationConfig: ConfigArray;

/** Overlay primitives may only be built from the shared UI package. */
export declare const overlayPrimitiveConfig: ConfigArray;

/** Menu styling may only come from the shared menu style exports. */
export declare const menuStyleBoundaryConfig: ConfigArray;

/** Application rosters may only receive column-header semantics from EntityTable. */
export declare const rosterOwnershipConfig: ConfigArray;

/** Semantic surface roles for the default cohort of component trees. */
export declare const semanticSurfaceConfig: ConfigArray;

/** Semantic surface roles, applied to one named cohort of component trees. */
export declare function semanticSurfaceCohortConfig(files: readonly string[]): ConfigArray;

/** Server components may not import the client query layer. */
export declare const serverComponentBoundaryConfig: ConfigArray;

/** The shared-UI ownership rules, as one composed block. */
export declare const uiOwnershipConfig: ConfigArray;

export default baseConfig;
