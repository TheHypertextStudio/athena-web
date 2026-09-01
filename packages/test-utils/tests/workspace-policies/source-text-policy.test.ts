import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { collectWorkspaceSourceFiles, relativeToWorkspaceRoot, WORKSPACE_ROOT } from '../workspace';

const NOTION_API_VERSION_LITERAL = '2026-03-11';
const NOTION_API_VERSION_SYMBOL = 'NOTION_API_VERSION';
const NOTION_PROTOCOL_MODULE = '@docket/connections/notion/api-contract';
const NOTION_PROTOCOL_SOURCE = 'domains/connections/src/notion/api-contract.ts';
const REQUIRED_NOTION_PROTOCOL_REFERENCES = [
  {
    file: 'packages/integrations/src/notion-mapping.ts',
    kind: 're-export',
    specifier: NOTION_PROTOCOL_MODULE,
  },
  {
    file: 'packages/integrations/src/notion.ts',
    kind: 'import',
    specifier: NOTION_PROTOCOL_MODULE,
  },
  {
    file: 'domains/connections/src/notion/adapters/notion-sdk-client.ts',
    kind: 'import',
    specifier: '../api-contract',
  },
] as const satisfies readonly {
  readonly file: string;
  readonly kind: NotionProtocolReferenceKind;
  readonly specifier: string;
}[];

type NotionProtocolRule =
  | 'canonical-definition'
  | 'duplicate-definition'
  | 'duplicate-literal'
  | 'missing-canonical-reference'
  | 'noncanonical-reference';

type NotionProtocolReferenceKind = 'import' | 're-export';

interface NotionProtocolViolation {
  readonly column: number;
  readonly detail: string;
  readonly file: string;
  readonly line: number;
  readonly rule: NotionProtocolRule;
}

interface SourceTextFile {
  readonly path: string;
  readonly sourceText: string;
}

interface LiteralNulByteViolation {
  readonly column: number;
  readonly file: string;
  readonly line: number;
}

function literalNulByteViolations(
  filePath: string,
  source: Buffer,
): readonly LiteralNulByteViolation[] {
  const violations: LiteralNulByteViolation[] = [];
  let offset = source.indexOf(0);

  while (offset !== -1) {
    const prefix = source.subarray(0, offset).toString('utf8');
    const lineStart = prefix.lastIndexOf('\n');
    violations.push({
      column: prefix.slice(lineStart + 1).length + 1,
      file: relativeToWorkspaceRoot(filePath),
      line: prefix.split('\n').length,
    });
    offset = source.indexOf(0, offset + 1);
  }

  return violations;
}

function sourceTextFiles(): readonly SourceTextFile[] {
  return collectWorkspaceSourceFiles().map((path) => ({
    path,
    sourceText: readFileSync(path, 'utf8'),
  }));
}

function fixtureSource(relativePath: string, sourceText: string): SourceTextFile {
  return { path: resolve(WORKSPACE_ROOT, relativePath), sourceText };
}

function canonicalNotionProtocolFixture(
  overrides: Readonly<Partial<Record<string, string>>> = {},
): readonly SourceTextFile[] {
  const sourceFor = (path: string, sourceText: string): string => overrides[path] ?? sourceText;
  return [
    fixtureSource(
      NOTION_PROTOCOL_SOURCE,
      sourceFor(
        NOTION_PROTOCOL_SOURCE,
        `export const ${NOTION_API_VERSION_SYMBOL} = '${NOTION_API_VERSION_LITERAL}';`,
      ),
    ),
    fixtureSource(
      'packages/integrations/src/notion-mapping.ts',
      sourceFor(
        'packages/integrations/src/notion-mapping.ts',
        `export { ${NOTION_API_VERSION_SYMBOL} } from '${NOTION_PROTOCOL_MODULE}';`,
      ),
    ),
    fixtureSource(
      'packages/integrations/src/notion.ts',
      sourceFor(
        'packages/integrations/src/notion.ts',
        `import { ${NOTION_API_VERSION_SYMBOL} } from '${NOTION_PROTOCOL_MODULE}';`,
      ),
    ),
    fixtureSource(
      'domains/connections/src/notion/adapters/notion-sdk-client.ts',
      sourceFor(
        'domains/connections/src/notion/adapters/notion-sdk-client.ts',
        `import { ${NOTION_API_VERSION_SYMBOL} } from '../api-contract';`,
      ),
    ),
    fixtureSource(
      'apps/api/src/calendar-date.ts',
      `const calendarDate = '${NOTION_API_VERSION_LITERAL}';`,
    ),
  ];
}

function isExportedConstDeclaration(node: ts.VariableDeclaration): boolean {
  const declarations = node.parent;
  const statement = declarations.parent;
  const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
  return (
    ts.isVariableDeclarationList(declarations) &&
    (declarations.flags & ts.NodeFlags.Const) !== 0 &&
    ts.isVariableStatement(statement) &&
    modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true
  );
}

function namedNotionApiVersionBinding(node: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  const clause = ts.isImportDeclaration(node)
    ? node.importClause?.namedBindings
    : node.exportClause;
  if (!clause || (!ts.isNamedImports(clause) && !ts.isNamedExports(clause))) return false;
  return clause.elements.some(
    (element) =>
      element.name.text === NOTION_API_VERSION_SYMBOL ||
      element.propertyName?.text === NOTION_API_VERSION_SYMBOL,
  );
}

function isNotionApiVersionInitializer(node: ts.StringLiteralLike): boolean {
  const declaration = node.parent;
  return (
    ts.isVariableDeclaration(declaration) &&
    declaration.initializer === node &&
    ts.isIdentifier(declaration.name) &&
    declaration.name.text === NOTION_API_VERSION_SYMBOL
  );
}

function notionProtocolViolations(
  files: readonly SourceTextFile[] = sourceTextFiles(),
): readonly NotionProtocolViolation[] {
  const violations: NotionProtocolViolation[] = [];
  let canonicalDefinitionCount = 0;
  let canonicalLiteralCount = 0;
  const canonicalReferences = new Set<string>();

  for (const { path, sourceText } of files) {
    if (
      !sourceText.includes(NOTION_API_VERSION_SYMBOL) &&
      !sourceText.includes(NOTION_API_VERSION_LITERAL)
    ) {
      continue;
    }
    const relativePath = relativeToWorkspaceRoot(path);
    const sourceFile = ts.createSourceFile(
      path,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    function report(node: ts.Node, rule: NotionProtocolRule, detail: string): void {
      const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      violations.push({
        column: location.character + 1,
        detail,
        file: relativePath,
        line: location.line + 1,
        rule,
      });
    }

    function visit(node: ts.Node): void {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === NOTION_API_VERSION_SYMBOL
      ) {
        if (relativePath !== NOTION_PROTOCOL_SOURCE) {
          report(node.name, 'duplicate-definition', 'defines the version outside Connections');
        } else {
          canonicalDefinitionCount += 1;
          if (!isExportedConstDeclaration(node)) {
            report(node.name, 'canonical-definition', 'must be an exported const');
          }
        }
      }

      if (
        ts.isStringLiteralLike(node) &&
        node.text === NOTION_API_VERSION_LITERAL &&
        isNotionApiVersionInitializer(node)
      ) {
        if (relativePath !== NOTION_PROTOCOL_SOURCE) {
          report(node, 'duplicate-literal', 'duplicates the Connections-owned version literal');
        } else {
          canonicalLiteralCount += 1;
        }
      }

      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        namedNotionApiVersionBinding(node)
      ) {
        const specifier = node.moduleSpecifier;
        const kind: NotionProtocolReferenceKind = ts.isImportDeclaration(node)
          ? 'import'
          : 're-export';
        const requiredReference = REQUIRED_NOTION_PROTOCOL_REFERENCES.find(
          (reference) => reference.file === relativePath && reference.kind === kind,
        );
        const expectedSpecifier = requiredReference?.specifier ?? NOTION_PROTOCOL_MODULE;
        if (
          !specifier ||
          !ts.isStringLiteralLike(specifier) ||
          specifier.text !== expectedSpecifier
        ) {
          report(
            node,
            'noncanonical-reference',
            `uses ${specifier?.getText(sourceFile) ?? 'no module specifier'} instead of ${expectedSpecifier}`,
          );
        } else {
          canonicalReferences.add(`${relativePath}:${kind}:${expectedSpecifier}`);
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  if (canonicalDefinitionCount !== 1) {
    violations.push({
      column: 1,
      detail: `expected one exported ${NOTION_API_VERSION_SYMBOL} definition, found ${canonicalDefinitionCount}`,
      file: NOTION_PROTOCOL_SOURCE,
      line: 1,
      rule: 'canonical-definition',
    });
  }
  if (canonicalLiteralCount !== 1) {
    violations.push({
      column: 1,
      detail: `expected one ${NOTION_API_VERSION_LITERAL} literal, found ${canonicalLiteralCount}`,
      file: NOTION_PROTOCOL_SOURCE,
      line: 1,
      rule: 'canonical-definition',
    });
  }
  for (const reference of REQUIRED_NOTION_PROTOCOL_REFERENCES) {
    if (canonicalReferences.has(`${reference.file}:${reference.kind}:${reference.specifier}`))
      continue;
    violations.push({
      column: 1,
      detail: `must ${reference.kind} ${NOTION_API_VERSION_SYMBOL} from ${reference.specifier}`,
      file: reference.file,
      line: 1,
      rule: 'missing-canonical-reference',
    });
  }

  return violations.sort(
    (left, right) =>
      left.file.localeCompare(right.file) || left.line - right.line || left.column - right.column,
  );
}

function formatNotionProtocolViolations(violations: readonly NotionProtocolViolation[]): string {
  return violations
    .map(
      (violation) =>
        `${violation.file}:${violation.line}:${violation.column} ` +
        `[${violation.rule}] ${violation.detail}`,
    )
    .join('\n');
}

describe('source text policy', () => {
  it('detects literal NUL bytes without rejecting escaped delimiters', () => {
    expect(
      literalNulByteViolations(
        '/workspace/src/example.ts',
        Buffer.from("const separator = '\\0';\n", 'utf8'),
      ),
    ).toEqual([]);
    expect(
      literalNulByteViolations(
        '/workspace/src/example.ts',
        Buffer.from("const separator = '\0';\n", 'utf8'),
      ),
    ).toEqual([
      {
        column: 20,
        file: '/workspace/src/example.ts',
        line: 1,
      },
    ]);
    expect(
      literalNulByteViolations(
        '/workspace/src/example.ts',
        Buffer.from("const label = '🙂\0';\n", 'utf8'),
      ),
    ).toEqual([
      {
        column: 18,
        file: '/workspace/src/example.ts',
        line: 1,
      },
    ]);
  });

  it('keeps authored TypeScript source readable by text-based tooling', () => {
    const violations = collectWorkspaceSourceFiles().flatMap((filePath) =>
      literalNulByteViolations(filePath, readFileSync(filePath)),
    );

    expect(
      violations,
      violations
        .map(
          (violation) =>
            `${violation.file}:${violation.line}:${violation.column} has a literal NUL byte.`,
        )
        .join('\n'),
    ).toEqual([]);
  });

  it('permits canonical protocol references without treating an unrelated date as a duplicate', () => {
    expect(notionProtocolViolations(canonicalNotionProtocolFixture())).toEqual([]);
  });

  it('rejects aliases, duplicate definitions, and missing required protocol references', () => {
    const aliasViolations = notionProtocolViolations(
      canonicalNotionProtocolFixture({
        'domains/connections/src/notion/adapters/notion-sdk-client.ts':
          "import { version as NOTION_API_VERSION } from './local-protocol';",
      }),
    );
    const importedNameAliasViolations = notionProtocolViolations(
      canonicalNotionProtocolFixture({
        'domains/connections/src/notion/adapters/notion-sdk-client.ts':
          "import { NOTION_API_VERSION as version } from './local-protocol';",
      }),
    );
    const duplicateViolations = notionProtocolViolations([
      ...canonicalNotionProtocolFixture(),
      fixtureSource(
        'packages/integrations/src/duplicate-notion-protocol.ts',
        `const ${NOTION_API_VERSION_SYMBOL} = '${NOTION_API_VERSION_LITERAL}';`,
      ),
    ]);
    const missingReferenceViolations = notionProtocolViolations(
      canonicalNotionProtocolFixture({
        'domains/connections/src/notion/adapters/notion-sdk-client.ts': 'export {};',
      }),
    );

    expect(aliasViolations).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: 'noncanonical-reference' })]),
    );
    expect(importedNameAliasViolations).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: 'noncanonical-reference' })]),
    );
    expect(duplicateViolations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: 'duplicate-definition' }),
        expect.objectContaining({ rule: 'duplicate-literal' }),
      ]),
    );
    expect(missingReferenceViolations).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: 'missing-canonical-reference' })]),
    );
  });

  it('keeps the Notion API protocol defined once and imported from Connections', () => {
    const violations = notionProtocolViolations();

    expect(
      violations,
      [
        'NOTION_API_VERSION belongs to the public Connections protocol, not an integration adapter.',
        'External adapters use the public protocol export; Connections source uses its direct protocol module.',
        formatNotionProtocolViolations(violations),
      ].join('\n'),
    ).toEqual([]);
  });
});
