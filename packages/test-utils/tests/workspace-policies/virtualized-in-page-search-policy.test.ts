import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { relativeToWorkspaceRoot, WORKSPACE_ROOT } from '../workspace';

type SearchAdapter = 'resident-complete' | 'server-cursor';
type VirtualPrimitive = 'EntityTable' | 'ListView';

interface SearchIntegration {
  readonly adapter: SearchAdapter;
  readonly evidenceFile: string;
  readonly evidenceText: string;
  readonly integrationFile?: string;
  readonly primitive: VirtualPrimitive;
}

const SEARCH_INTEGRATIONS: Readonly<Record<string, SearchIntegration>> = {
  'apps/web/src/app/(app)/orgs/[orgId]/my-work/my-work-client.tsx': {
    adapter: 'resident-complete',
    evidenceFile: 'apps/web/src/lib/my-work-defs.ts',
    evidenceText: 'tasks.$get({ param: { orgId }, query: {} })',
    primitive: 'ListView',
  },
  'apps/web/src/app/(app)/orgs/[orgId]/triage/page.tsx': {
    adapter: 'resident-complete',
    evidenceFile: 'apps/web/src/lib/use-triage.ts',
    evidenceText: 'tasks.$get({ param: { orgId }, query: {} })',
    primitive: 'ListView',
  },
  'apps/web/src/components/library/library-client.tsx': {
    adapter: 'server-cursor',
    evidenceFile: 'apps/web/src/components/library/library-client.tsx',
    evidenceText: 'apiInfiniteQueryOptions<SearchOut>',
    primitive: 'EntityTable',
  },
  'apps/web/src/components/views/view-runner.tsx': {
    adapter: 'resident-complete',
    evidenceFile: 'apps/web/src/app/(app)/orgs/[orgId]/views/use-views-page.ts',
    evidenceText: 'tasks.$get({ param: { orgId }, query: {} })',
    primitive: 'ListView',
  },
  'apps/web/src/components/work-views/work-list.tsx': {
    adapter: 'server-cursor',
    evidenceFile: 'apps/web/src/components/work-views/use-work-view.ts',
    evidenceText: "api.v1.orgs[':orgId']['work-views'].query.$post",
    integrationFile: 'apps/web/src/components/work-views/work-view-page.tsx',
    primitive: 'ListView',
  },
};

function productionTypeScriptFiles(root: string): readonly string[] {
  return ts.sys
    .readDirectory(resolve(WORKSPACE_ROOT, root), ['.ts', '.tsx'], undefined, undefined)
    .filter((path) => !/\.(?:test|spec)\.tsx?$/.test(path));
}

function sourceFile(path: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function importedLocalNames(file: ts.SourceFile, symbol: VirtualPrimitive): ReadonlySet<string> {
  const names = new Set<string>();
  for (const statement of file.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== '@docket/ui/components' ||
      !statement.importClause?.namedBindings ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      continue;
    }
    for (const element of statement.importClause.namedBindings.elements) {
      if ((element.propertyName ?? element.name).text === symbol) names.add(element.name.text);
    }
  }
  return names;
}

function usesPrimitive(file: ts.SourceFile, primitive: VirtualPrimitive): boolean {
  const localNames = importedLocalNames(file, primitive);
  if (localNames.size === 0) return false;
  let used = false;
  function visit(node: ts.Node): void {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isIdentifier(node.tagName) &&
      localNames.has(node.tagName.text)
    ) {
      if (primitive === 'ListView') used = true;
      else {
        used = node.attributes.properties.some(
          (attribute) =>
            ts.isJsxAttribute(attribute) &&
            ts.isIdentifier(attribute.name) &&
            attribute.name.text === 'virtualized',
        );
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return used;
}

function productCallers(): readonly string[] {
  const callers: string[] = [];
  for (const path of productionTypeScriptFiles('apps/web/src')) {
    const file = sourceFile(path);
    if (usesPrimitive(file, 'ListView') || usesPrimitive(file, 'EntityTable')) {
      callers.push(relativeToWorkspaceRoot(path));
    }
  }
  return callers.sort();
}

describe('virtualized in-page search policy', () => {
  it('recognizes aliased primitive imports instead of letting callers evade the inventory', () => {
    const file = ts.createSourceFile(
      'aliased.tsx',
      "import { ListView as VirtualList } from '@docket/ui/components'; export const View = () => <VirtualList />;",
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );

    expect(usesPrimitive(file, 'ListView')).toBe(true);
  });

  it('keeps TanStack Virtual ownership inside the two shared rendering primitives', () => {
    const owners = productionTypeScriptFiles('packages/ui/src')
      .filter((path) => readFileSync(path, 'utf8').includes('useVirtualizer('))
      .map(relativeToWorkspaceRoot)
      .sort();

    expect(owners).toEqual([
      'packages/ui/src/components/views/EntityTable.tsx',
      'packages/ui/src/components/views/ListView.tsx',
    ]);
  });

  it('requires every product caller to declare and prove its complete-corpus search adapter', () => {
    const callers = productCallers();
    expect(Object.keys(SEARCH_INTEGRATIONS).sort()).toEqual(callers);

    for (const path of callers) {
      const integration = SEARCH_INTEGRATIONS[path];
      expect(integration, `${path} has no reviewed search adapter`).toBeDefined();
      if (!integration) continue;
      const absolutePath = resolve(WORKSPACE_ROOT, path);
      const integrationSource = readFileSync(
        resolve(WORKSPACE_ROOT, integration.integrationFile ?? path),
        'utf8',
      );
      expect(usesPrimitive(sourceFile(absolutePath), integration.primitive)).toBe(true);
      expect(
        readFileSync(resolve(WORKSPACE_ROOT, integration.evidenceFile), 'utf8'),
        `${path} no longer has the reviewed ${integration.adapter} completeness evidence`,
      ).toContain(integration.evidenceText);
      expect(integrationSource).toContain('useInPageSearchTarget');
      expect(integrationSource).toContain('InPageSearchField');
      if (integration.adapter === 'resident-complete') {
        expect(integrationSource).toContain("completeness: 'complete'");
        expect(integrationSource).toContain('useResidentInPageSearch');
      }
    }
  });
});
