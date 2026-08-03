import { describe, expect, it } from 'vitest';

import { findUndocumentedDeclarations } from '../../src/doc-coverage';
import { collectWorkspaceSourceFiles, relativeToWorkspaceRoot } from '../workspace';

describe('documentation coverage', () => {
  it('every exported declaration across the workspace has a TSDoc comment', () => {
    const files = collectWorkspaceSourceFiles();
    expect(files.length).toBeGreaterThan(0);
    const undocumented = findUndocumentedDeclarations(files);
    const report = undocumented
      .map((u) => `  ${relativeToWorkspaceRoot(u.file)}:${u.line} — ${u.kind} ${u.name}`)
      .join('\n');
    expect(
      undocumented,
      `\nUndocumented declarations (${undocumented.length}):\n${report}\n`,
    ).toEqual([]);
  }, // A full-workspace source scan: the monorepo has grown enough that this can exceed the
  // default 30s timeout under coverage instrumentation on a slower CI runner, even though it
  // finishes in a few seconds locally. Generous, not tuned to a moving target.
  120_000);
});
