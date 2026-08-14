import { Lexer } from 'marked';
import { describe, expect, it } from 'vitest';

import { EXCERPT_SKIP_TOKEN_TYPES, childTokensOf } from '../src/index';
import { assertDefined } from '@docket/test-utils';

describe('childTokensOf', () => {
  it("returns a paragraph token's inline children", () => {
    const [paragraph] = new Lexer().lex('Some *emphasized* text.');
    expect(paragraph?.type).toBe('paragraph');
    const children = childTokensOf(assertDefined(paragraph));
    expect(children.length).toBeGreaterThan(0);
    expect(children.some((token) => token.type === 'em')).toBe(true);
  });

  it("returns a list's items", () => {
    const [list] = new Lexer().lex('- one\n- two');
    expect(list?.type).toBe('list');
    const children = childTokensOf(assertDefined(list));
    expect(children).toHaveLength(2);
    expect(children.every((token) => token.type === 'list_item')).toBe(true);
  });

  it("flattens a table's header and row cells into one array", () => {
    const [table] = new Lexer().lex(['| A | B |', '| --- | --- |', '| 1 | 2 |'].join('\n'));
    expect(table?.type).toBe('table');
    const children = childTokensOf(assertDefined(table));
    // Two header cells' inline tokens plus two row cells' inline tokens, flattened together.
    const text = children.map((token) => ('text' in token ? token.text : '')).join('');
    expect(text).toContain('A');
    expect(text).toContain('B');
    expect(text).toContain('1');
    expect(text).toContain('2');
  });

  it('returns an empty array for a leaf token with no children', () => {
    const [heading] = new Lexer().lex('# Just a heading');
    const [textToken] = childTokensOf(assertDefined(heading));
    // The heading's own inline children exist; go one level deeper to a genuine leaf.
    expect(childTokensOf(assertDefined(textToken))).toEqual([]);
  });
});

describe('EXCERPT_SKIP_TOKEN_TYPES', () => {
  it('includes the non-prose block kinds an excerpt should never quote', () => {
    for (const type of ['code', 'table', 'space', 'hr', 'html', 'def']) {
      expect(EXCERPT_SKIP_TOKEN_TYPES.has(type)).toBe(true);
    }
  });

  it('does not skip ordinary prose block kinds', () => {
    for (const type of ['paragraph', 'heading', 'list', 'blockquote', 'text']) {
      expect(EXCERPT_SKIP_TOKEN_TYPES.has(type)).toBe(false);
    }
  });
});
