import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { findUndocumentedDeclarations } from './doc-coverage';

const ROOT = resolve(import.meta.dirname, '../../..');

/** Collect every non-test `.ts`/`.tsx` source file under each package's and app's `src`. */
function collectSourceFiles(): string[] {
  const out: string[] = [];
  for (const group of ['packages', 'apps']) {
    const base = resolve(ROOT, group);
    if (!existsSync(base)) continue;
    for (const pkg of readdirSync(base, { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue;
      const srcDir = resolve(base, pkg.name, 'src');
      if (!existsSync(srcDir)) continue;
      for (const entry of readdirSync(srcDir, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const { name } = entry;
        if (!/\.(ts|tsx)$/.test(name)) continue;
        if (/\.(test|spec)\.tsx?$/.test(name) || name.endsWith('.d.ts')) continue;
        const dir = (entry as { parentPath?: string }).parentPath ?? srcDir;
        out.push(resolve(dir, name));
      }
    }
  }
  return out;
}

describe('documentation coverage', () => {
  it('every exported declaration across the workspace has a TSDoc comment', () => {
    const files = collectSourceFiles();
    expect(files.length).toBeGreaterThan(0);
    const undocumented = findUndocumentedDeclarations(files);
    const report = undocumented
      .map((u) => `  ${u.file.replace(`${ROOT}/`, '')}:${u.line} — ${u.kind} ${u.name}`)
      .join('\n');
    expect(
      undocumented,
      `\nUndocumented declarations (${undocumented.length}):\n${report}\n`,
    ).toEqual([]);
  });
});
