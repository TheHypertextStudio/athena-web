/**
 * Source contract: every create composer scopes its draft state to a single open.
 *
 * @remarks
 * The behavior itself is pinned by `composer-reset.test.tsx`, but only for the Projects composer —
 * rendering all six against mocked RPC clients would cost far more than it proves, since they share
 * one mechanism. This contract covers the other five cheaply and, more importantly, guards the two
 * ways the original bug could return:
 *
 * 1. **An unwrapped composer.** A composer that exports its stateful function directly keeps its
 *    draft for the life of the host page, and every close path leaks it.
 * 2. **A hand-rolled reset block.** The pattern that failed in production was an `onOpenChange`
 *    wrapper that reset each field on close. It is worth failing loudly on, not just deleting: it
 *    looks correct, it is easy to reach for, and its gap (the successful-create path closes the
 *    dialog without going through it) is invisible at the call site.
 *
 * A new create composer is expected to be added to {@link COMPOSERS} along with its `withComposerReset`
 * wrap.
 *
 * @see {@link withComposerReset} for why the reset is keyed to open rather than close.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../../');

/** Every create composer, with the exported component name its host pages render. */
const COMPOSERS: readonly { file: string; exported: string }[] = [
  { file: 'apps/web/src/components/tasks/create-task.tsx', exported: 'CreateTaskDialog' },
  { file: 'apps/web/src/components/projects/create-project.tsx', exported: 'CreateProjectDialog' },
  {
    file: 'apps/web/src/components/initiatives/create-initiative.tsx',
    exported: 'CreateInitiativeDialog',
  },
  { file: 'apps/web/src/components/programs/create-program.tsx', exported: 'CreateProgramDialog' },
  { file: 'apps/web/src/components/teams/create-team.tsx', exported: 'CreateTeamDialog' },
  { file: 'apps/web/src/components/cycles/create-cycle.tsx', exported: 'CreateCycleDialog' },
];

/** Read a repo-relative source file. */
function source(file: string): string {
  return readFileSync(join(root, file), 'utf8');
}

describe('Create composer draft-lifetime contract', () => {
  it.each(COMPOSERS)('wraps $exported in withComposerReset', ({ file, exported }) => {
    const text = source(file);

    expect(text).toContain("from '@/components/composer/reset-on-open'");
    // The wrap must be at the export site, so no host page can render an unmanaged variant.
    expect(text).toContain(`export const ${exported} = withComposerReset(`);
    expect(text).not.toContain(`export function ${exported}(`);
  });

  it.each(COMPOSERS)('$exported hands the host open state straight through', ({ file }) => {
    const text = source(file);

    // Regression guard: the reset used to hang off an `onOpenChange` wrapper that the
    // successful-create path bypassed by calling the host's prop directly. With the lifetime keyed
    // to open, there is nothing left to intercept — the prop goes to the shell untouched.
    expect(text).toContain('onOpenChange={onOpenChange}');
    expect(text).not.toContain('handleOpenChange');
  });
});
