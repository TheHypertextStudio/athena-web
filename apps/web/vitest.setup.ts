/**
 * `@docket/web` — Vitest setup.
 *
 * @remarks
 * Registers the `@testing-library/jest-dom` matchers and raises Testing Library's internal
 * `asyncUtilTimeout` (the deadline `findBy*`/`waitFor` use, separate from and much shorter than
 * Vitest's own `testTimeout`). Its 1000ms default is comfortable on local hardware but not under
 * CI, where Turbo runs every package's suite concurrently with `--coverage` instrumentation on
 * top — the same oversubscription documented in `tooling/vitest/preset.ts`. A query that resolves
 * in well under a second locally can lose that race on a loaded CI runner, failing a correct
 * component with "unable to find" rather than a real bug.
 */
import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/dom';

configure({ asyncUtilTimeout: 5_000 });
