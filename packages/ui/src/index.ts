/**
 * `@docket/ui` — Docket design system (JIT, consumed via `transpilePackages`).
 *
 * @remarks
 * Tokens live in `./styles/globals.css`. This barrel re-exports the utility layer — the
 * `cn` class-merger, org-accent helpers, and the canonical keyboard-focus convention
 * (`focusRing` / `focusRingInset`) — so any consumer can `cn(..., focusRing)` without reaching
 * into a subpath. The shadcn primitives, app shell, and ListView family (authored across FND-P5)
 * are exposed via their own subpaths (`./primitives`, `./components`, `./hooks`).
 */
export { cn } from './lib/utils';
export { getOrgAccent, ORG_ACCENT_PALETTE } from './lib/org-accent';
export { focusRing, focusRingInset } from './primitives/focus';
