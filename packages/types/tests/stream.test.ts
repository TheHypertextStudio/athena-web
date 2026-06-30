import { describe, expect, it } from 'vitest';

import { StreamEventOut, StreamPageOut, StreamQuery, StreamRelevance } from '../src/stream';

// Valid ULID-shaped ids for the branded primitives.
const ORG = '01KW8H4PY49X0PCHXY0G8Y68PX';
const EVT = '01KW8H4PYWAZECQC0GJPABN60X';
const INT = '01KW8RPQ0MN015ZFCRBX0HR60G';

const baseEvent = {
  id: EVT,
  organizationId: ORG,
  source: {
    system: 'linear' as const,
    integrationId: INT,
    externalUrl: 'https://linear.app/acme/issue/ENG-482',
  },
  kind: 'status_change' as const,
  occurredAt: '2026-06-29T17:00:00.000Z',
  title: 'ENG-482 moved to Done',
  summary: 'In Progress → Done',
  permalink: 'https://linear.app/acme/issue/ENG-482',
  actor: {
    source: 'linear' as const,
    externalId: 'u_dani',
    displayName: 'Dani',
    avatarUrl: null,
    docketActorId: null,
  },
  entity: {
    kind: 'work_item' as const,
    source: 'linear' as const,
    externalId: 'ENG-482',
    title: 'Ship the beta',
    url: 'https://linear.app/acme/issue/ENG-482',
    docketEntityId: null,
  },
  participants: [
    {
      source: 'linear' as const,
      externalId: 'u_dani',
      displayName: 'Dani',
      avatarUrl: null,
      docketActorId: null,
    },
  ],
  detail: { schema: 'docket.state_change' as const, fromState: 'In Progress', toState: 'Done' },
  relevance: 'owned' as const,
  rendering: { icon: 'check', category: 'progress' },
  createdAt: '2026-06-29T17:00:01.000Z',
};

describe('StreamEventOut', () => {
  it('parses a full external event', () => {
    const parsed = StreamEventOut.parse(baseEvent);
    expect(parsed.source.system).toBe('linear');
    expect(parsed.relevance).toBe('owned');
    expect(parsed.entity?.kind).toBe('work_item');
  });

  it('accepts null relevance (workspace firehose) and null nullables', () => {
    const parsed = StreamEventOut.parse({
      ...baseEvent,
      source: { system: 'docket', integrationId: null, externalUrl: null },
      summary: null,
      permalink: null,
      actor: null,
      entity: null,
      detail: null,
      relevance: null,
    });
    expect(parsed.relevance).toBeNull();
    expect(parsed.source.integrationId).toBeNull();
    expect(parsed.detail).toBeNull();
  });

  it('rejects an unknown kind', () => {
    expect(StreamEventOut.safeParse({ ...baseEvent, kind: 'exploded' }).success).toBe(false);
  });

  it('rejects an unknown source system', () => {
    expect(
      StreamEventOut.safeParse({ ...baseEvent, source: { ...baseEvent.source, system: 'other' } })
        .success,
    ).toBe(false);
  });

  it('accepts the generic detail variant for unmapped events', () => {
    const parsed = StreamEventOut.parse({
      ...baseEvent,
      detail: {
        schema: 'generic',
        title: 'Something happened in Figma',
        summary: null,
        url: 'https://figma.com/x',
      },
    });
    expect(parsed.detail?.schema).toBe('generic');
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
      system: 'slack',
      kind: 'mention',
      entityKind: 'thread',
    });
    expect(parsed.filter).toBe('eyJ4IjoxfQ==');
    expect(parsed.system).toBe('slack');
    expect(parsed.kind).toBe('mention');
    expect(parsed.entityKind).toBe('thread');
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
