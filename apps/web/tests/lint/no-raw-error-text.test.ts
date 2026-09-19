import { type ESLint, Linter, type Linter as LinterTypes } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

import uiOwnershipPlugin from '../../../../tooling/eslint-config/plugin.js';

const RULE = 'docket-ui/no-raw-error-text';

const CONFIG: LinterTypes.Config[] = [
  {
    files: ['**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaFeatures: { jsx: true }, projectService: false },
    },
    plugins: { 'docket-ui': uiOwnershipPlugin as ESLint.Plugin },
    rules: { [RULE]: 'error' },
  },
];

/** Lint one TSX snippet with only the error-presentation rule on. */
function messagesFor(code: string): readonly string[] {
  const linter = new Linter();
  const results = linter.verify(code, CONFIG, {
    filename: 'apps/web/src/components/example.tsx',
  });
  return results.map((result) => result.messageId ?? '');
}

describe('docket-ui/no-raw-error-text', () => {
  it('flags a hand-painted error paragraph', () => {
    expect(
      messagesFor('const x = <p role="alert" className="text-error text-body-medium">{e}</p>;'),
    ).toEqual(['errorUtility', 'rawAlert']);
  });

  it('flags error tints in any form, with or without a state modifier', () => {
    expect(messagesFor('const x = <div className="border-error/40 bg-error/5" />;')).toEqual([
      'errorUtility',
    ]);
    expect(messagesFor('const x = <span className="hover:text-error" />;')).toEqual([
      'errorUtility',
    ]);
    expect(
      messagesFor('const x = <span className={cn("a", ok && "bg-error-container")} />;'),
    ).toEqual(['errorUtility']);
  });

  it('leaves the feedback primitives and other roles alone', () => {
    expect(messagesFor('const x = <FieldError>Enter a name.</FieldError>;')).toEqual([]);
    expect(
      messagesFor('const x = <InlineBanner tone="critical" title="t">b</InlineBanner>;'),
    ).toEqual([]);
    expect(
      messagesFor('const x = <p role="status" className="text-on-surface-variant" />;'),
    ).toEqual([]);
    expect(
      messagesFor('const x = <span className="text-primary bg-surface-container" />;'),
    ).toEqual([]);
  });
});
