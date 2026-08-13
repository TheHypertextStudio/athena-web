import { describe, expect, it } from 'vitest';

import { htmlFragmentToMarkdown } from '../../../src/lib/clipboard/html-to-markdown';

/**
 * Rendered prose — a posted comment, a read-only body — has no editor behind it, so this walker is
 * the only thing that can answer "what Markdown produced this?". Its whole job is that copying from
 * something Docket rendered from Markdown gives Markdown back, including from a partial selection,
 * which is the case source offsets cannot serve.
 */

/** Build a fragment from markup, the way a selection's `cloneContents()` would. */
function fragment(html: string): DocumentFragment {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content;
}

/** Convert markup straight to Markdown. */
function md(html: string): string {
  return htmlFragmentToMarkdown(fragment(html));
}

describe('htmlFragmentToMarkdown', () => {
  it('restores headings at their original level', () => {
    expect(md('<h1>Rollout plan</h1><h3>Risks</h3>')).toBe('# Rollout plan\n\n### Risks');
  });

  it('separates paragraphs with a blank line', () => {
    expect(md('<p>First</p><p>Second</p>')).toBe('First\n\nSecond');
  });

  it('restores inline emphasis, strikethrough, underline, and code', () => {
    expect(md('<p><strong>a</strong> <em>b</em> <del>c</del> <u>d</u> <code>e</code></p>')).toBe(
      '**a** *b* ~~c~~ ++d++ `e`',
    );
  });

  it('leaves a code span’s content untouched, because it is data', () => {
    expect(md('<p><code>arr[0] * 2</code></p>')).toBe('`arr[0] * 2`');
  });

  it('restores links and images', () => {
    expect(md('<p><a href="/orgs/o/tasks/t">Task</a></p>')).toBe('[Task](/orgs/o/tasks/t)');
    expect(md('<p><img src="/v1/orgs/o/images/i" alt="Chart"></p>')).toBe(
      '![Chart](/v1/orgs/o/images/i)',
    );
  });

  it('restores bullet and ordered lists', () => {
    expect(md('<ul><li><p>One</p></li><li><p>Two</p></li></ul>')).toBe('- One\n- Two');
    expect(md('<ol start="3"><li><p>Three</p></li><li><p>Four</p></li></ol>')).toBe(
      '3. Three\n4. Four',
    );
  });

  it('restores checkboxes without letting the checkbox itself become text', () => {
    const html =
      '<ul data-type="taskList">' +
      '<li data-type="taskItem" data-checked="true"><label><input type="checkbox"></label><div><p>Done</p></div></li>' +
      '<li data-type="taskItem" data-checked="false"><label><input type="checkbox"></label><div><p>Todo</p></div></li>' +
      '</ul>';

    expect(md(html)).toBe('- [x] Done\n- [ ] Todo');
  });

  it('indents a nested list under its parent item', () => {
    const html = '<ul><li><p>Parent</p><ul><li><p>Child</p></li></ul></li></ul>';

    expect(md(html)).toBe('- Parent\n\n  - Child');
  });

  it('prefixes every line of a blockquote, including the blank one between paragraphs', () => {
    // The blank line must carry the marker, or the quote ends and a second one begins.
    expect(md('<blockquote><p>One</p><p>Two</p></blockquote>')).toBe('> One\n>\n> Two');
  });

  it('restores a code block’s fence and language, and drops its chrome', () => {
    const html =
      '<div data-code-block="" data-code-language="ts">' +
      '<div><span>TypeScript</span><button>Copy</button></div>' +
      '<pre><code>const x = 1;\n</code></pre>' +
      '<p class="sr-only">Code copied.</p>' +
      '</div>';

    // The language label and the Copy button are chrome; only the source is content.
    expect(md(html)).toBe('```ts\nconst x = 1;\n```');
  });

  it('restores a table with its column alignment', () => {
    const html =
      '<table><thead><tr>' +
      '<th style="text-align: left">Name</th><th style="text-align: right">Count</th>' +
      '</tr></thead><tbody><tr><td>Tasks</td><td>3</td></tr></tbody></table>';

    expect(md(html)).toBe('| Name | Count |\n| --- | ---: |\n| Tasks | 3 |');
  });

  it('restores a thematic break', () => {
    expect(md('<p>A</p><hr><p>B</p>')).toBe('A\n\n---\n\nB');
  });

  it('restores a hard line break within a paragraph', () => {
    expect(md('<p>First<br>Second</p>')).toBe('First  \nSecond');
  });

  it('restores a bare code block, which carries no language', () => {
    expect(md('<pre><code>plain text\n</code></pre>')).toBe('```\nplain text\n```');
  });

  it('restores centred column alignment', () => {
    const html =
      '<table><thead><tr><th style="text-align: center">Mid</th></tr></thead>' +
      '<tbody><tr><td>x</td></tr></tbody></table>';

    expect(md(html)).toBe('| Mid |\n| :---: |\n| x |');
  });

  it('escapes a pipe inside a cell so it cannot end the column', () => {
    const html =
      '<table><thead><tr><th>Expr</th></tr></thead><tbody><tr><td>a | b</td></tr></tbody></table>';

    expect(md(html)).toContain('a \\| b');
  });

  it('has nothing to say about a table with no rows', () => {
    expect(md('<table></table>')).toBe('');
  });

  it('keeps link text when the anchor points nowhere', () => {
    expect(md('<p><a>Unlinked</a></p>')).toBe('Unlinked');
  });

  it('keeps an image with no alt text', () => {
    expect(md('<p><img src="/v1/orgs/o/images/i"></p>')).toBe('![](/v1/orgs/o/images/i)');
  });

  it('unwraps a structural container, such as a table’s scroll region', () => {
    expect(md('<div class="overflow-x-auto"><p>Inside</p></div>')).toBe('Inside');
  });

  it('gathers loose text into a paragraph, which is how a partial selection begins', () => {
    // A selection starting mid-paragraph clones a bare text node, with no wrapping element.
    expect(md('the middle of a sentence<p>Then a whole one</p>')).toBe(
      'the middle of a sentence\n\nThen a whole one',
    );
  });

  it('escapes characters that would otherwise be read back as syntax', () => {
    expect(md('<p>Fix [Button] and *stars*</p>')).toBe('Fix \\[Button\\] and \\*stars\\*');
  });

  it('keeps intra-word underscores readable rather than over-escaping them', () => {
    expect(md('<p>snake_case_name</p>')).toBe('snake_case_name');
  });

  it('degrades an unknown element to its children rather than guessing', () => {
    expect(md('<p>Hello <mark>there</mark></p>')).toBe('Hello there');
  });

  it('has nothing to say about an empty fragment', () => {
    expect(md('')).toBe('');
    expect(md('<p>   </p>')).toBe('');
  });
});
