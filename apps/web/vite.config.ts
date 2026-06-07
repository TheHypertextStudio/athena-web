import { docketVitest } from '../../tooling/vitest/preset';

/**
 * Vitest config for `@docket/web`.
 *
 * @remarks
 * The web app is a large Next.js surface verified primarily by typecheck, lint, and by running
 * the live dev/prod app — not by unit-testing every component. So coverage is deliberately
 * scoped (via `coverageInclude`) to the small set of pure, behavior-bearing modules that warrant
 * a unit test on their own: currently the Settings information-architecture registry, whose
 * personal-vs-org gate (which sections a workspace sees, and its default section) is logic that
 * must stay correct independent of the React tree that renders it. Widen `coverageInclude` as
 * more such pure modules gain tests; the bar stays meaningful, never a chase over wiring/UI code.
 *
 * Tests live under `tests/` (never colocated in `src/`), mirroring every other Docket package.
 * jsdom + the React plugin are enabled so component/DOM tests can be added here without a config
 * change.
 */
export default docketVitest({
  environment: 'jsdom',
  react: true,
  coverageInclude: ['src/components/settings/sections.ts'],
});
