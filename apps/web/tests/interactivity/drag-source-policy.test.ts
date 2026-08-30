import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const WEB_ROOT = resolve(import.meta.dirname, '../..');
const SOURCE_ROOT = resolve(WEB_ROOT, 'src');
const UI_SOURCE_ROOT = resolve(WEB_ROOT, '../../packages/ui/src');
const DND_IMPORT_ALLOWLIST = new Set([
  'src/components/dnd/drag-context.tsx',
  'src/components/dnd/object-pointer-sensor.ts',
  'src/components/dnd/source-aware-collision-detector.ts',
  'src/components/dnd/use-scheduling-slot-drop-target.ts',
  'src/components/dnd/use-draggable.ts',
  'src/components/dnd/use-relation-drop-target.ts',
  'src/components/work-views/work-board.tsx',
]);
const LEGACY_MODULES = [
  'entity-drag',
  'drag-payload',
  'use-drop-target',
  'scheduling-drag-object',
  'use-task-hierarchy-drag',
];

interface SourceFile {
  readonly path: string;
  readonly text: string;
}

/** Discover application TypeScript source with stable repository-relative paths. */
function sources(directory: string): readonly SourceFile[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry): readonly SourceFile[] => {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) return sources(absolute);
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) return [];
    return [
      {
        path: relative(WEB_ROOT, absolute).split(sep).join('/'),
        text: readFileSync(absolute, 'utf8'),
      },
    ];
  });
}

/** Report transport imports and native object drags outside the interaction boundary. */
function violations(source: SourceFile): readonly string[] {
  const file = ts.createSourceFile(
    source.path,
    source.text,
    ts.ScriptTarget.Latest,
    true,
    source.path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      if (specifier.startsWith('@dnd-kit/') && !DND_IMPORT_ALLOWLIST.has(source.path)) {
        found.push(`${source.path}: Dnd Kit import ${specifier}`);
      }
      if (LEGACY_MODULES.some((legacy) => specifier.includes(legacy))) {
        found.push(`${source.path}: legacy drag module ${specifier}`);
      }
    }
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === 'draggable') {
      found.push(`${source.path}: native draggable attribute`);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe('object drag source policy', () => {
  it('keeps one transport behind approved interaction and spatial adapters', () => {
    expect([...sources(SOURCE_ROOT), ...sources(UI_SOURCE_ROOT)].flatMap(violations)).toEqual([]);
  });

  it('detects a native object drag and an unapproved Dnd Kit import', () => {
    expect(
      violations({
        path: 'src/components/tasks/rogue-row.tsx',
        text: `import {useDraggable} from '@dnd-kit/react'; export const Row=()=> <div draggable />;`,
      }),
    ).toHaveLength(2);
  });

  it('keeps canvas hierarchy changes behind the Alt association adapter', () => {
    const graph = sources(SOURCE_ROOT).find(
      ({ path }) => path === 'src/components/canvas/task-graph-panel.tsx',
    );
    const node = sources(SOURCE_ROOT).find(
      ({ path }) => path === 'src/components/canvas/task-node.tsx',
    );
    expect(graph?.text).not.toMatch(/onNodeDrag(?:Start|Stop)?=/);
    expect(node?.text).toContain('associationModifier="alt"');
  });
});
