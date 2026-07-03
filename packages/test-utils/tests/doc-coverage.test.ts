import { describe, expect, it } from 'vitest';

import { findUndocumentedDeclarations } from '../src/doc-coverage';
import { collectWorkspaceSourceFiles, relativeToWorkspaceRoot } from './workspace';

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
  });
});
