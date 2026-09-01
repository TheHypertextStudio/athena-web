import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  Linter,
  type AST,
  type ESLint,
  type Linter as LinterTypes,
  type Rule,
  type Scope,
} from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

import uiOwnershipPlugin from '../../../../tooling/eslint-config/plugin.js';

const root = resolve(import.meta.dirname, '../../../../');
const ownershipRule = 'docket-ui/no-app-owned-columnheader';
const rosterPaths = [
  'apps/web/src/components/teams/team-list-ui.tsx',
  'apps/web/src/components/cycles/cycle-row.tsx',
  'apps/web/src/components/work-views/work-list.tsx',
];

interface JSXOpeningElement {
  type: 'JSXOpeningElement';
  name: { type: string; name?: string };
}

interface RosterRuleContext {
  sourceCode: {
    getScope(node: JSXOpeningElement): Scope.Scope;
  };
  report(descriptor: { node: AST.Program; messageId: 'missingOwner' }): void;
}

function resolvesToSharedEntityTable(
  node: JSXOpeningElement,
  sourceCode: RosterRuleContext['sourceCode'],
): boolean {
  if (node.name.type !== 'JSXIdentifier' || node.name.name === undefined) return false;
  let scope: Scope.Scope | null = sourceCode.getScope(node);
  while (scope !== null) {
    const variable = scope.set.get(node.name.name);
    if (variable !== undefined) {
      return variable.defs.some(
        (definition) =>
          definition.type === 'ImportBinding' &&
          definition.node.type === 'ImportSpecifier' &&
          definition.node.imported.type === 'Identifier' &&
          definition.node.imported.name === 'EntityTable' &&
          definition.parent.source.value === '@docket/ui/components',
      );
    }
    scope = scope.upper;
  }
  return false;
}

const requireEntityTable: Rule.RuleModule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { missingOwner: 'Render the roster through EntityTable.' },
  },
  create(ruleContext) {
    const context = ruleContext as unknown as RosterRuleContext;
    let ownsRoster = false;
    const sourceCode = context.sourceCode;
    const listener = {
      JSXOpeningElement(node: JSXOpeningElement) {
        if (resolvesToSharedEntityTable(node, sourceCode)) ownsRoster = true;
      },
      'Program:exit'(node: AST.Program) {
        if (!ownsRoster) context.report({ node, messageId: 'missingOwner' });
      },
    };
    return listener as unknown as Rule.RuleListener;
  },
};

function rosterOwnerMessages(code: string): LinterTypes.LintMessage[] {
  const linter = new Linter();
  return linter.verify(code, {
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true }, projectService: false },
    },
    plugins: { 'roster-test': { rules: { 'require-entity-table': requireEntityTable } } },
    rules: { 'roster-test/require-entity-table': 'error' },
  });
}

describe('EntityTable ownership', () => {
  it('executes the AST ownership policy on application code but not its shared owner', () => {
    const linter = new Linter();
    const policyConfig: LinterTypes.Config[] = [
      {
        files: ['apps/web/src/**/*.{ts,tsx}'],
        languageOptions: {
          parser: tseslint.parser,
          parserOptions: { ecmaFeatures: { jsx: true }, projectService: false },
        },
        plugins: { 'docket-ui': uiOwnershipPlugin as ESLint.Plugin },
        rules: { [ownershipRule]: 'error' },
      },
    ];
    const bypass = linter.verify(
      'const role = "columnheader"; <div role={role} />;',
      policyConfig,
      { filename: 'apps/web/src/components/ownership-bypass.tsx' },
    );
    const sharedOwner = linter.verify('<div role="columnheader" />;', policyConfig, {
      filename: 'packages/ui/src/components/entity-table.tsx',
    });

    expect(bypass.some((message) => message.ruleId === ownershipRule)).toBe(true);
    expect(sharedOwner.some((message) => message.ruleId === ownershipRule)).toBe(false);
  });

  it('composes the roster ownership policy into the repository lint gate', () => {
    expect(readFileSync(join(root, 'eslint.config.js'), 'utf8')).toContain(
      '...rosterOwnershipConfig',
    );
  });

  it('renders each roster adapter through EntityTable instead of retaining a dead import', () => {
    for (const path of rosterPaths) {
      expect(rosterOwnerMessages(readFileSync(join(root, path), 'utf8'))).toEqual([]);
    }
  });

  it('requires the rendered owner to resolve to the shared EntityTable import', () => {
    const shared =
      'import { EntityTable } from "@docket/ui/components"; export const Roster = () => <EntityTable />;';
    const local = 'const EntityTable = () => null; export const Roster = () => <EntityTable />;';
    const foreign =
      'import { EntityTable } from "./local-table"; export const Roster = () => <EntityTable />;';
    const shadowed =
      'import { EntityTable } from "@docket/ui/components"; function Roster() { const EntityTable = () => null; return <EntityTable />; }';

    expect(rosterOwnerMessages(shared)).toEqual([]);
    expect(rosterOwnerMessages(local)).toHaveLength(1);
    expect(rosterOwnerMessages(foreign)).toHaveLength(1);
    expect(rosterOwnerMessages(shadowed)).toHaveLength(1);
  });
});
