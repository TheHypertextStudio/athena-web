import {
  appLocationConfig,
  baseConfig,
  dataLayerConfig,
  overlayPrimitiveConfig,
  semanticSurfaceCohortConfig,
} from './tooling/eslint-config/index.js';

/**
 * Root flat ESLint config. Kept thin: the shared Docket preset (`@docket/eslint-config`,
 * `tooling/eslint-config`) is the single source of truth for rules and ignores, and the
 * data-layer enforcement lives there too. Compose them here; add repo-specific overrides
 * (if any) after the spreads.
 *
 * @type {import('typescript-eslint').ConfigArray}
 */
export default [
  ...baseConfig,
  ...dataLayerConfig,
  ...appLocationConfig,
  ...overlayPrimitiveConfig,
  ...semanticSurfaceCohortConfig([
    'apps/web/src/components/agenda/**/*.{ts,tsx}',
    'apps/web/src/components/time-tracking/**/*.{ts,tsx}',
  ]),
];
