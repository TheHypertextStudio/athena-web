/**
 * `@docket/ui` — Docket design system (JIT, consumed via `transpilePackages`).
 *
 * @remarks
 * Tokens live in `./styles/globals.css`. This barrel re-exports the utility layer;
 * the shadcn primitives, app shell, and ListView family (authored across FND-P5)
 * are exposed via their own subpaths (`./primitives`, `./components`, `./hooks`).
 */
export { cn } from './lib/utils';
export { getOrgAccent, ORG_ACCENT_PALETTE } from './lib/org-accent';
