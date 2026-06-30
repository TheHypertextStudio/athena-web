import { describe, expect, it } from 'vitest';

import { StreamEventOut, StreamPageOut, StreamQuery, StreamRelevance } from '../src/stream';

// Valid ULID-shaped ids for the branded primitives.
const ORG = '01KW8H4PY49X0PCHXY0G8Y68PX';
const OBS = '01KW8H4PYWAZECQC0GJPABN60X';
const INT = '01KW8RPQ0MN015ZFCRBX0HR60G';

const baseEvent = {
  id: OBS,
  organizationId: ORG,
  source: { provider: 'linear', integrationId: INT, origin: 'external' as const },
  kind: 'status_change' as const,
  occurredAt: '2026-06-29T17:00:00.000Z',
  title: 'ENG-482 moved to Done',
  summary: 'In Progress → Done',
  permalink: 'https://linear.app/acme/issue/ENG-482',
  actor: { externalId: 'u_dani', displayName: 'Dani' },
  subject: { type: 'issue', externalId: 'ENG-482', title: 'Ship the beta' },
  participants: [{ externalId: 'u_dani', displayName: 'Dani' }],
  payload: { state: { from: 'In Progress', to: 'Done' } },
  relevance: 'owned' as const,
  rendering: { icon: 'check', category: 'progress' },
  createdAt: '2026-06-29T17:00:01.000Z',
};

describe('StreamEventOut', () => {
  it('parses a full external event', () => {
    const parsed = StreamEventOut.parse(baseEvent);
    expect(parsed.source.provider).toBe('linear');
    expect(parsed.relevance).toBe('owned');
    expect(parsed.payload).toEqual({ state: { from: 'In Progress', to: 'Done' } });
  });

  it('accepts null relevance (workspace firehose) and null nullables', () => {
    const parsed = StreamEventOut.parse({
      ...baseEvent,
      source: { provider: 'docket', integrationId: null, origin: 'docket' },
      summary: null,
      permalink: null,
      actor: null,
      subject: null,
      relevance: null,
    });
    expect(parsed.relevance).toBeNull();
    expect(parsed.source.integrationId).toBeNull();
  });

  it('rejects an unknown kind', () => {
    expect(StreamEventOut.safeParse({ ...baseEvent, kind: 'exploded' }).success).toBe(false);
  });

  it('rejects an unknown source origin', () => {
    expect(
      StreamEventOut.safeParse({ ...baseEvent, source: { ...baseEvent.source, origin: 'other' } })
        .success,
    ).toBe(false);
  });
});

describe('StreamRelevance', () => {
  it('does not include workspace (firehose uses null)', () => {
    expect(StreamRelevance.safeParse('workspace').success).toBe(false);
    expect(StreamRelevance.safeParse('mention').success).toBe(true);
  });
});

describe('StreamQuery', () => {
  it('inherits ListQuery defaults', () => {
    const parsed = StreamQuery.parse({});
    expect(parsed.limit).toBe(50);
    expect(parsed.order).toBe('desc');
  });

  it('accepts filter, viewId, and quick-filters', () => {
    const parsed = StreamQuery.parse({
      filter: 'eyJ4IjoxfQ==',
      viewId: 'v1',
      provider: 'slack',
      kind: 'mention',
    });
    expect(parsed.filter).toBe('eyJ4IjoxfQ==');
    expect(parsed.provider).toBe('slack');
    expect(parsed.kind).toBe('mention');
  });

  it('rejects an invalid quick-filter kind', () => {
    expect(StreamQuery.safeParse({ kind: 'nope' }).success).toBe(false);
  });
});

describe('StreamPageOut', () => {
  it('parses a page of events with a cursor', () => {
    const parsed = StreamPageOut.parse({ items: [baseEvent], nextCursor: 'cur' });
    expect(parsed.items).toHaveLength(1);
    expect(parsed.nextCursor).toBe('cur');
  });
});
