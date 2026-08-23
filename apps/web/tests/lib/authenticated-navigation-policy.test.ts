import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const webRoot = join(import.meta.dirname, '../..');
const roots = [join(webRoot, 'src/app/(app)'), join(webRoot, 'src/components')];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return ['.ts', '.tsx'].includes(extname(path)) ? [path] : [];
  });
}

describe('authenticated navigation source policy', () => {
  it('keeps imperative Next routing behind the shared navigation seam', () => {
    const violations = roots
      .flatMap(sourceFiles)
      .filter((file) => readFileSync(file, 'utf8').includes("useRouter } from 'next/navigation'"))
      .map((file) => file.slice(webRoot.length + 1));

    expect(violations).toEqual([]);
  });
});
