import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { Linter, type Rule } from 'eslint';
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

const requireEntityTable: Rule.RuleModule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: { missingOwner: 'Render the roster through EntityTable.' },
  },
  create(context) {
    let ownsRoster = false;
    return {
      JSXOpeningElement(node) {
        if (node.name.type === 'JSXIdentifier' && node.name.name === 'EntityTable') {
          ownsRoster = true;
        }
      },
      'Program:exit'(node) {
        if (!ownsRoster) context.report({ node, messageId: 'missingOwner' });
      },
    };
  },
};

describe('EntityTable ownership', () => {
  it('executes the AST ownership policy on application code but not its shared owner', () => {
    const linter = new Linter();
    const policyConfig = [
      {
        files: ['apps/web/src/**/*.{ts,tsx}'],
        languageOptions: {
          parser: tseslint.parser,
          parserOptions: { ecmaFeatures: { jsx: true }, projectService: false },
        },
        plugins: { 'docket-ui': uiOwnershipPlugin },
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
    const linter = new Linter();

    for (const path of rosterPaths) {
      const messages = linter.verify(readFileSync(join(root, path), 'utf8'), {
        languageOptions: {
          parser: tseslint.parser,
          parserOptions: { ecmaFeatures: { jsx: true }, projectService: false },
        },
        plugins: { 'roster-test': { rules: { 'require-entity-table': requireEntityTable } } },
        rules: { 'roster-test/require-entity-table': 'error' },
      });

      expect(messages).toEqual([]);
    }
  });
});
