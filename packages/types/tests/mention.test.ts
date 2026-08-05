import { describe, expect, it } from 'vitest';

import {
  MENTION_MARKER_PREFIX,
  formatMentionLink,
  formatMentionMarker,
  mentionRefKey,
  parseMentionMarker,
  type MentionRef,
} from '../src/mention';

const PROJECT: MentionRef = {
  kind: 'entity',
  entityKind: 'project',
  entityId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
};
const EXTERNAL: MentionRef = {
  kind: 'external',
  url: 'https://docs.google.com/document/d/abc123/edit',
};

describe('formatMentionMarker', () => {
  it('encodes an entity ref as kind and id', () => {
    expect(formatMentionMarker(PROJECT)).toBe(
      `${MENTION_MARKER_PREFIX}project:01ARZ3NDEKTSV4RRFFQ69G5FAV`,
    );
  });

  it('encodes an external ref without repeating the href', () => {
    expect(formatMentionMarker(EXTERNAL)).toBe(`${MENTION_MARKER_PREFIX}external`);
  });
});

describe('parseMentionMarker', () => {
  it('round-trips both arms through the link form', () => {
    expect(parseMentionMarker('/orgs/1/projects/2', formatMentionMarker(PROJECT))).toEqual(PROJECT);
    expect(parseMentionMarker(EXTERNAL.url, formatMentionMarker(EXTERNAL))).toEqual(EXTERNAL);
  });

  it('reads an external target from the href, not the marker, so a moved URL is a new reference', () => {
    expect(
      parseMentionMarker('https://example.com/moved', `${MENTION_MARKER_PREFIX}external`),
    ).toEqual({
      kind: 'external',
      url: 'https://example.com/moved',
    });
  });

  it('declines a link with no title, so an ordinary link falls through to the Link mark', () => {
    expect(parseMentionMarker('https://example.com', undefined)).toBeUndefined();
  });

  it('declines a link whose title is prose rather than a marker', () => {
    expect(parseMentionMarker('https://example.com', 'The quarterly plan')).toBeUndefined();
  });

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    '  javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'blob:https://example.com/uuid',
  ])('refuses to make %s navigable even with a valid marker', (href) => {
    expect(parseMentionMarker(href, `${MENTION_MARKER_PREFIX}external`)).toBeUndefined();
    expect(parseMentionMarker(href, formatMentionMarker(PROJECT))).toBeUndefined();
  });

  it('declines an external marker with an empty href', () => {
    expect(parseMentionMarker('', `${MENTION_MARKER_PREFIX}external`)).toBeUndefined();
  });

  it('declines a malformed entity marker rather than throwing', () => {
    expect(parseMentionMarker('/a', `${MENTION_MARKER_PREFIX}project`)).toBeUndefined();
    expect(
      parseMentionMarker('/a', `${MENTION_MARKER_PREFIX}:01ARZ3NDEKTSV4RRFFQ69G5FAV`),
    ).toBeUndefined();
    expect(parseMentionMarker('/a', `${MENTION_MARKER_PREFIX}project:`)).toBeUndefined();
  });

  it('declines an entity kind outside the mentionable set', () => {
    expect(
      parseMentionMarker('/a', `${MENTION_MARKER_PREFIX}organization:01ARZ3NDEKTSV4RRFFQ69G5FAV`),
    ).toBeUndefined();
  });

  it('keeps colons inside an id intact', () => {
    expect(parseMentionMarker('/a', `${MENTION_MARKER_PREFIX}task:has:colons`)).toEqual({
      kind: 'entity',
      entityKind: 'task',
      entityId: 'has:colons',
    });
  });
});

describe('formatMentionLink', () => {
  it('produces a link a plain Markdown renderer shows as an ordinary link', () => {
    expect(formatMentionLink('Q3 launch plan', EXTERNAL.url, EXTERNAL)).toBe(
      `[Q3 launch plan](${EXTERNAL.url} "${MENTION_MARKER_PREFIX}external")`,
    );
  });

  it('escapes brackets in the label so they cannot end the link early', () => {
    const rendered = formatMentionLink('Plan [draft]', '/orgs/1/projects/2', PROJECT);
    expect(rendered).toContain('[Plan \\[draft\\]]');
  });

  it('escapes a backslash in the label so it cannot escape the escape', () => {
    expect(formatMentionLink('a\\b', '/a', PROJECT)).toContain('[a\\\\b]');
  });

  it('escapes parentheses and whitespace in the href so they cannot end the target early', () => {
    const rendered = formatMentionLink('Doc', 'https://example.com/a(b) c', EXTERNAL);
    expect(rendered).toContain('https://example.com/a%28b%29%20c');
    expect(rendered.match(/\)/g)).toHaveLength(1);
  });

  it('survives a round trip through its own parser', () => {
    const rendered = formatMentionLink('Platform rebuild', '/orgs/1/projects/2', PROJECT);
    const match = /^\[(?<label>.*)\]\((?<href>\S+) "(?<title>[^"]+)"\)$/u.exec(rendered);
    expect(match?.groups).toBeDefined();
    expect(parseMentionMarker(match?.groups?.['href'] ?? '', match?.groups?.['title'])).toEqual(
      PROJECT,
    );
  });
});

describe('mentionRefKey', () => {
  it('namespaces the two arms so an entity and a URL can never collide', () => {
    expect(mentionRefKey(PROJECT)).toBe('docket:project:01ARZ3NDEKTSV4RRFFQ69G5FAV');
    expect(mentionRefKey(EXTERNAL)).toBe(`url:${EXTERNAL.url}`);
  });
});
