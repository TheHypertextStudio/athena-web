/**
 * Production source policy for the global object-creation cutover.
 *
 * @remarks
 * Rendered command and composer tests cover request and completion behavior. This policy walks the
 * complete production TypeScript tree so a new launcher cannot restore a page-owned supported
 * dialog, local modal state, or creation query bridge outside the originally inventoried paths.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB_ROOT = resolve(import.meta.dirname, '../..');
const SOURCE_ROOT = resolve(WEB_ROOT, 'src');

interface ProductionSource {
  readonly path: string;
  readonly text: string;
}

/** Recursively discover every production TypeScript source below a directory. */
function discoverProductionSources(directory: string): readonly ProductionSource[] {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry): readonly ProductionSource[] => {
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) return discoverProductionSources(absolutePath);
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) return [];
      return [
        {
          path: relative(WEB_ROOT, absolutePath),
          text: readFileSync(absolutePath, 'utf8'),
        },
      ];
    });
}

const PRODUCTION_SOURCES = discoverProductionSources(SOURCE_ROOT);
const OWNER_FILES = new Set([
  'src/components/tasks/create-task.tsx',
  'src/components/projects/create-project.tsx',
  'src/components/initiatives/create-initiative.tsx',
  'src/components/programs/create-program.tsx',
  'src/components/teams/create-team.tsx',
]);
const SUPPORTED_DIALOG = /\bCreate(?:Task|Project|Initiative|Program|Team)Dialog\b/;
const IMPORT_STATEMENT = /\bimport\s+[\s\S]*?\s+from\s+['"][^'"]+['"];?/g;
const DIALOG_MOUNT = /<Create(?:Task|Project|Initiative|Program|Team)Dialog\b/;

describe('global creation launcher source policy', () => {
  it('recursively inventories the complete production TypeScript tree', () => {
    const paths = PRODUCTION_SOURCES.map((entry) => entry.path);

    expect(paths.length).toBeGreaterThan(700);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toContain('src/components/create-object/create-object-provider.tsx');
    expect(paths).toContain('src/app/(app)/orgs/[orgId]/projects/[projectId]/page.tsx');
    expect(paths.every((path) => path.startsWith('src/') && /\.tsx?$/.test(path))).toBe(true);
  });

  it('has no supported creation URL bridge anywhere in production', () => {
    for (const entry of PRODUCTION_SOURCES) {
      expect(entry.text, entry.path).not.toContain('useComposeRequest');
      expect(entry.text, entry.path).not.toContain('composeHref');
    }
    expect(existsSync(resolve(SOURCE_ROOT, 'components/composer/use-compose-param.ts'))).toBe(
      false,
    );
  });

  it('mounts or imports supported dialogs only inside their five owning implementations', () => {
    for (const entry of PRODUCTION_SOURCES) {
      if (OWNER_FILES.has(entry.path)) continue;
      const imports = [...entry.text.matchAll(IMPORT_STATEMENT)].map((match) => match[0]);
      expect(
        imports.some((statement) => SUPPORTED_DIALOG.test(statement)),
        entry.path,
      ).toBe(false);
      expect(DIALOG_MOUNT.test(entry.text), entry.path).toBe(false);
    }
  });

  it('has no page-owned supported-kind modal state patterns', () => {
    for (const entry of PRODUCTION_SOURCES) {
      expect(entry.text, entry.path).not.toMatch(
        /\b(?:createOpen|setCreateOpen|taskComposerOpen|setTaskComposerOpen)\b/,
      );
    }
  });

  it('allows only the Initiative update composer compose query', () => {
    const occurrences = PRODUCTION_SOURCES.flatMap((entry) =>
      entry.text
        .split('\n')
        .map((line, index) => ({ path: entry.path, line: index + 1, text: line.trim() }))
        .filter((line) => line.text.includes('compose=1')),
    );

    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]?.path).toBe(
      'src/app/(app)/orgs/[orgId]/initiatives/initiatives-client.tsx',
    );
    expect(occurrences[0]?.text).toContain("item.action === 'update'");
    expect(occurrences[0]?.text).toContain('?tab=updates&compose=1');
  });
});
