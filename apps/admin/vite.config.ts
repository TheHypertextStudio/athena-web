import { fileURLToPath } from 'node:url';

import { docketVitest } from '../../tooling/vitest/preset';

/**
 * Vitest config for `@docket/admin`.
 *
 * @remarks
 * The operator console is a Next.js surface verified primarily by typecheck, lint, and by running
 * it — not by unit-testing every component. Coverage is therefore scoped (via `coverageInclude`)
 * to the pure, behavior-bearing modules that warrant a gate of their own, mirroring
 * `@docket/web`'s config. The React component tests still run; they simply are not what the
 * threshold is measured over.
 *
 * The `@/` alias mirrors `tsconfig.json`'s `paths` so component tests can import app modules by
 * the same specifier the app uses (Vitest does not read `tsconfig` paths on its own).
 */
const config = docketVitest({
  react: true,
  coverageInclude: [
    // Problem-document parsing is the console's only translation from an API error into operator
    // copy. It decides what an operator is told when something fails, so it is gated on its own.
    'src/lib/problem.ts',
    // Complimentary-plan settlement decides what an org's billing state becomes after an operator
    // acts. Getting it wrong silently changes what a customer is charged.
    'src/app/**/complimentary-settlement.ts',
    // The announcement draft model turns operator input into the create payload that fans out to
    // every recipient. A malformed draft reaching the API is a broadcast that cannot be recalled.
    'src/app/**/notification-console-model.ts',
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
