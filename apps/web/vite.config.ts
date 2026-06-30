import { fileURLToPath } from 'node:url';

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
 * change. The `@/` alias mirrors `tsconfig.json`'s `paths` so component tests can import app
 * modules by the same specifier the app uses (Vitest does not read `tsconfig` paths on its own).
 */
const config = docketVitest({
  environment: 'jsdom',
  react: true,
  coverageInclude: [
    'src/components/settings/sections.ts',
    // The open-documents route matcher is pure logic with a behavioral guard (it rejects
    // malformed ids so no junk "Session undefined" tab is ever opened), so it earns its own gate.
    'src/components/tabs/route-tabs.ts',
    // The unified filtering engine: the field-catalog model, the pure filter/group/sort apply
    // function, and the ViewState↔URL codec are pure, behavior-bearing logic every list page
    // depends on (a malformed predicate or a hand-edited URL must degrade, never blank a list),
    // so each earns its own gate independent of the React tree that renders the toolbar.
    'src/components/views/field-catalog.ts',
    'src/components/views/apply-view.ts',
    'src/components/views/view-state-url.ts',
    // The task estimate formatter is pure, behavior-bearing display logic (an unset/zero estimate
    // must collapse to a neutral placeholder, not "0m"), shared by every aligned task table.
    'src/lib/format-estimate.ts',
    // The Today "Next up" selector is pure, behavior-bearing logic: which few things show next
    // (upcoming timeboxed blocks, start-ordered, else tasks due today) must stay correct
    // independent of the React tree that renders the list.
    'src/components/today/next-up-select.ts',
  ],
});

config.resolve = {
  ...config.resolve,
  alias: {
    ...config.resolve?.alias,
    '@': fileURLToPath(new URL('./src', import.meta.url)),
  },
};

export default config;
