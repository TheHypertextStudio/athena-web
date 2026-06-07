import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { findUndocumentedDeclarations, type UndocumentedDeclaration } from '../src/doc-coverage';

let dir: string;

/** Write `source` to a temp file named `name` and return its absolute path. */
function fixture(name: string, source: string): string {
  const path = join(dir, name);
  writeFileSync(path, source, 'utf8');
  return path;
}

/** Run the harness over a single source string and return the findings. */
function scan(name: string, source: string): UndocumentedDeclaration[] {
  return findUndocumentedDeclarations([fixture(name, source)]);
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'doc-coverage-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('findUndocumentedDeclarations internals', () => {
  it('flags an undocumented exported function declaration', () => {
    const found = scan('fn.ts', `export function noDoc() {}\n`);
    expect(found).toEqual([
      { file: join(dir, 'fn.ts'), name: 'noDoc', kind: 'FunctionDeclaration', line: 1 },
    ]);
  });

  it('flags undocumented exported class, interface, type alias, and enum declarations', () => {
    const source = [
      'export class C {}',
      'export interface I { x: number }',
      'export type T = number;',
      'export enum E { A }',
    ].join('\n');
    const found = scan('decls.ts', `${source}\n`);
    expect(found.map((f) => ({ name: f.name, kind: f.kind, line: f.line }))).toEqual([
      { name: 'C', kind: 'ClassDeclaration', line: 1 },
      { name: 'I', kind: 'InterfaceDeclaration', line: 2 },
      { name: 'T', kind: 'TypeAliasDeclaration', line: 3 },
      { name: 'E', kind: 'EnumDeclaration', line: 4 },
    ]);
  });

  it('flags an undocumented exported module/namespace declaration', () => {
    const found = scan('ns.ts', `export namespace N { export const x = 1; }\n`);
    expect(found).toHaveLength(1);
    expect(found[0]?.name).toBe('N');
    expect(found[0]?.kind).toBe('ModuleDeclaration');
  });

  it('joins names for a multi-declarator exported variable statement', () => {
    const found = scan('vars.ts', `export const a = 1, b = 2;\n`);
    expect(found).toEqual([
      { file: join(dir, 'vars.ts'), name: 'a, b', kind: 'VariableStatement', line: 1 },
    ]);
  });

  it('reports the 1-based line number of a later declaration', () => {
    const source = ['// leading comment', '', 'export const onLineFour = 1;'].join('\n');
    const found = scan('line.ts', `${source}\n`);
    expect(found).toHaveLength(1);
    expect(found[0]?.line).toBe(3);
  });

  it('uses "(default)" as the name for an anonymous default-exported declaration', () => {
    const found = scan('default.ts', `export default class {}\n`);
    expect(found).toHaveLength(1);
    expect(found[0]?.name).toBe('(default)');
    expect(found[0]?.kind).toBe('ClassDeclaration');
  });

  it('skips a documented exported variable statement', () => {
    const found = scan('doc-var.ts', `/** documented */\nexport const documented = 1;\n`);
    expect(found).toEqual([]);
  });

  it('skips a documented exported declaration', () => {
    const found = scan('doc-fn.ts', `/** documented */\nexport function documented() {}\n`);
    expect(found).toEqual([]);
  });

  it('skips a non-exported variable statement', () => {
    const found = scan('local-var.ts', `const local = 1;\n`);
    expect(found).toEqual([]);
  });

  it('skips a non-exported declaration', () => {
    const found = scan('local-fn.ts', `function local() {}\nclass Local {}\n`);
    expect(found).toEqual([]);
  });

  it('ignores statements that are neither variables nor named declarations', () => {
    const found = scan('expr.ts', `console.log('side effect');\n`);
    expect(found).toEqual([]);
  });

  it('parses .tsx files with the TSX script kind', () => {
    const source = ['export const View = () => <div className="x">hi</div>;'].join('\n');
    const found = scan('view.tsx', `${source}\n`);
    expect(found).toEqual([
      { file: join(dir, 'view.tsx'), name: 'View', kind: 'VariableStatement', line: 1 },
    ]);
  });

  it('returns an empty array when given no files', () => {
    expect(findUndocumentedDeclarations([])).toEqual([]);
  });
});
