import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function sourceFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.tsx') ? [path] : [];
  });
}

describe('Settings heading discovery policy', () => {
  it('requires descriptors for static headings and explicit exclusions for data-derived headings', () => {
    const violations: string[] = [];

    for (const path of sourceFiles(join(process.cwd(), 'src'))) {
      const source = readFileSync(path, 'utf8');
      const openingTags = source.match(/<Settings(?:Group|Subsection)\b[\s\S]*?>/g) ?? [];
      for (const tag of openingTags) {
        if (!tag.includes('title=')) continue;
        const hasLiteralTitle = /title\s*=\s*["']/.test(tag);
        const excludesDynamicHeading = /discoverable\s*=\s*\{false\}/.test(tag);
        if (hasLiteralTitle || !excludesDynamicHeading) {
          violations.push(`${path.replace(`${process.cwd()}/`, '')}: ${tag.split('\n')[0]}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
