/**
 * Behavior tests for conversation search.
 *
 * @remarks
 * The property the module claims is that a literal match is never dropped for being less
 * relevant than something else — only an explicit `limit` removes rows. That is what makes the
 * result trustworthy for a person scrolling their own history, so it is tested directly rather
 * than inferred from the ranking.
 *
 * `semantic` is checked against what was supplied rather than what was used, because a caller
 * showing a "semantic" badge needs to know vectors were in play even for a message that had no
 * embedding of its own.
 */
import { describe, expect, it } from 'vitest';

import type { ConversationMessage } from '../src/conversation-contracts';
import {
  cosineSimilarity,
  matchSpans,
  searchConversation,
  withinRange,
} from '../src/conversation-search';

/** Build a message at a fixed offset in minutes from a stable base instant. */
function message(id: string, text: string, minute: number): ConversationMessage {
  return { id, role: 'user', text, at: new Date(Date.UTC(2026, 0, 1, 0, minute)) };
}

const INVOICES = message('m1', 'The invoice for Acme is overdue.', 0);
const RENEWAL = message('m2', 'Acme renewal is next quarter.', 10);
const UNRELATED = message('m3', 'Lunch with the design team.', 20);
const ALL = [INVOICES, RENEWAL, UNRELATED];

describe('matchSpans', () => {
  it('finds whole-word matches and reports their offsets', () => {
    expect(matchSpans('Acme and acme', ['acme'])).toEqual([
      { start: 0, end: 4 },
      { start: 9, end: 13 },
    ]);
  });

  it('does not match inside a longer word', () => {
    // A substring highlight would underline half a word, which reads as a bug to the person.
    expect(matchSpans('acmecorp', ['acme'])).toEqual([]);
  });

  it('returns nothing when there are no words to look for', () => {
    expect(matchSpans('anything at all', [])).toEqual([]);
  });
});

describe('cosineSimilarity', () => {
  it('scores identical directions 1 and orthogonal ones 0', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 0], [2, 0])).toBeCloseTo(1);
  });

  it('treats a zero vector as no similarity rather than dividing by zero', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(cosineSimilarity([1, 1], [0, 0])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('compares only the overlapping dimensions of ragged vectors', () => {
    expect(cosineSimilarity([1, 0, 99], [1, 0])).toBeCloseTo(1);
  });
});

describe('withinRange', () => {
  const at = new Date(Date.UTC(2026, 0, 10));
  it('treats both bounds as inclusive and either as optional', () => {
    expect(withinRange(at)).toBe(true);
    expect(withinRange(at, at)).toBe(true);
    expect(withinRange(at, undefined, at)).toBe(true);
    expect(withinRange(at, new Date(Date.UTC(2026, 0, 11)))).toBe(false);
    expect(withinRange(at, undefined, new Date(Date.UTC(2026, 0, 9)))).toBe(false);
  });
});

describe('searchConversation', () => {
  it('returns the whole window newest-first when there is no query text', () => {
    const result = searchConversation(ALL, {});
    expect(result.hits.map((hit) => hit.message.id)).toEqual(['m3', 'm2', 'm1']);
    expect(result.total).toBe(3);
    expect(result.semantic).toBe(false);
    // Nothing matched literally, so no row claims a lexical hit.
    expect(result.hits.every((hit) => !hit.lexical)).toBe(true);
  });

  it('applies the date window before anything else', () => {
    const result = searchConversation(ALL, {
      from: new Date(Date.UTC(2026, 0, 1, 0, 5)),
      to: new Date(Date.UTC(2026, 0, 1, 0, 15)),
    });
    expect(result.hits.map((hit) => hit.message.id)).toEqual(['m2']);
  });

  it('keeps every literal match, and caps only when asked', () => {
    const unlimited = searchConversation(ALL, { text: 'Acme' });
    expect(unlimited.hits.map((hit) => hit.message.id).sort()).toEqual(['m1', 'm2']);
    expect(unlimited.total).toBe(2);

    const capped = searchConversation(ALL, { text: 'Acme' }, { limit: 1 });
    expect(capped.hits).toHaveLength(1);
    // `total` still reports the truth, so a caller can say "showing 1 of 2".
    expect(capped.total).toBe(2);
  });

  it('caps an empty-query result too', () => {
    expect(searchConversation(ALL, {}, { limit: 2 }).hits).toHaveLength(2);
  });

  it('drops a message that matches nothing', () => {
    const result = searchConversation(ALL, { text: 'invoice' });
    expect(result.hits.map((hit) => hit.message.id)).toEqual(['m1']);
    expect(result.hits[0]?.highlights.length).toBeGreaterThan(0);
    expect(result.hits[0]?.lexical).toBe(true);
  });

  it('handles a query whose words are all filtered out as noise', () => {
    const result = searchConversation(ALL, { text: '   ' });
    // Whitespace is not a query, so this behaves like no text at all.
    expect(result.total).toBe(3);
  });

  it('reports semantic whenever vectors were supplied, used or not', () => {
    const withVectors = searchConversation(
      ALL,
      { text: 'Acme' },
      { vectors: { query: [1, 0], byMessageId: new Map() } },
    );
    expect(withVectors.semantic).toBe(true);
    // No message had an embedding, so ranking fell back to lexical alone — but the caller still
    // needs to know vectors were in play.
    expect(withVectors.hits).toHaveLength(2);
  });

  it('surfaces a semantically close message that shares no query word', () => {
    const result = searchConversation(
      ALL,
      { text: 'invoice' },
      {
        vectors: {
          query: [1, 0],
          byMessageId: new Map([['m3', [1, 0]]]),
        },
      },
    );
    const ids = result.hits.map((hit) => hit.message.id);
    expect(ids).toContain('m3');
    // It is a real hit, but not a literal one, and the flag has to say so.
    expect(result.hits.find((hit) => hit.message.id === 'm3')?.lexical).toBe(false);
    expect(result.hits.find((hit) => hit.message.id === 'm1')?.lexical).toBe(true);
  });

  it('ignores a message whose embedding points the other way', () => {
    const result = searchConversation(
      ALL,
      { text: 'invoice' },
      { vectors: { query: [1, 0], byMessageId: new Map([['m3', [-1, 0]]]) } },
    );
    expect(result.hits.map((hit) => hit.message.id)).toEqual(['m1']);
  });

  it('ranks a semantic match above a weaker lexical one', () => {
    const result = searchConversation(
      [INVOICES, RENEWAL],
      { text: 'Acme' },
      { vectors: { query: [1, 0], byMessageId: new Map([['m2', [1, 0]]]) } },
    );
    expect(result.hits[0]?.message.id).toBe('m2');
  });

  it('breaks a score tie by recency', () => {
    const first = message('a', 'Acme', 0);
    const second = message('b', 'Acme', 5);
    const result = searchConversation([first, second], { text: 'Acme' });
    expect(result.hits.map((hit) => hit.message.id)).toEqual(['b', 'a']);
  });

  it('searches an empty conversation without dividing by zero', () => {
    const result = searchConversation([], { text: 'Acme' });
    expect(result).toMatchObject({ hits: [], total: 0, semantic: false });
    expect(result.terms.length).toBeGreaterThan(0);
  });
});
