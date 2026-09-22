import { describe, expect, it } from 'vitest';

import { decodeEditorEntities, isLineBreakHtml, safeLinkHref } from '../src/index';

describe('decodeEditorEntities', () => {
  it('turns the entities the editor writes back into the characters the author typed', () => {
    expect(decodeEditorEntities('Institutional &amp; Agency &lt;draft&gt; &quot;v2&quot;')).toBe(
      'Institutional & Agency <draft> "v2"',
    );
  });

  it('decodes an escaped entity only once', () => {
    expect(decodeEditorEntities('&amp;lt; is how you write &lt;')).toBe('&lt; is how you write <');
  });

  it('decodes the apostrophe the figure codec writes', () => {
    expect(decodeEditorEntities('Driver&#39;s seat')).toBe("Driver's seat");
  });

  it('leaves entities the editor never writes alone', () => {
    expect(decodeEditorEntities('&copy; 2026')).toBe('&copy; 2026');
  });
});

describe('isLineBreakHtml', () => {
  it('recognises every spelling of a line break', () => {
    expect(['<br>', '<br/>', '<br />', '<BR>'].every(isLineBreakHtml)).toBe(true);
  });

  it('refuses any other tag', () => {
    expect(isLineBreakHtml('<b>')).toBe(false);
    expect(isLineBreakHtml('<br class="x">')).toBe(false);
  });
});

describe('safeLinkHref', () => {
  it('allows web links and app paths', () => {
    expect(safeLinkHref(' https://weekwithoutdriving.org ')).toBe('https://weekwithoutdriving.org');
    expect(safeLinkHref('http://example.com/a')).toBe('http://example.com/a');
    expect(safeLinkHref('/orgs/org_1/projects/p_1')).toBe('/orgs/org_1/projects/p_1');
  });

  it('refuses every other scheme and protocol-relative hosts', () => {
    expect(safeLinkHref('javascript:alert(1)')).toBeUndefined();
    expect(safeLinkHref('data:text/html,hi')).toBeUndefined();
    expect(safeLinkHref('//evil.example/x')).toBeUndefined();
    expect(safeLinkHref('https://')).toBeUndefined();
    expect(safeLinkHref('mailto:a@b.c')).toBeUndefined();
  });
});
