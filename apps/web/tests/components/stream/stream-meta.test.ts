import { describe, expect, it } from 'vitest';

import { type StreamEventOut as StreamEventOutType, StreamEventOut } from '@docket/types';

import { kindGlyph, streamDescription, streamHref, toRow } from '@/components/stream/stream-meta';

const OBS = '01KW8H4PYWAZECQC0GJPABN60X';
const ORG = '01KW8H4PY49X0PCHXY0G8Y68PX';
const INT = '01KW8RPQ0MN015ZFCRBX0HR60G';

// Parse fixtures through the schema so branded ids (EventId/OrganizationId/…) are real.
function event(over: Record<string, unknown> = {}): StreamEventOutType {
  return StreamEventOut.parse({
    id: OBS,
    organizationId: ORG,
    source: {
      system: 'linear',
      integrationId: INT,
      externalUrl: 'https://linear.app/acme/issue/ENG-482',
    },
    kind: 'mention',
    occurredAt: '2026-06-29T12:00:00.000Z',
    title: 'You were mentioned: Ship the beta',
    summary: 'review the OAuth fix',
    permalink: 'https://linear.app/acme/issue/ENG-482',
    actor: {
      source: 'linear',
      externalId: 'u_maya',
      displayName: 'Maya',
      avatarUrl: null,
      docketActorId: null,
    },
    entity: {
      kind: 'work_item',
      source: 'linear',
      externalId: 'ENG-482',
      title: 'Ship the beta',
      url: null,
      docketEntityId: null,
    },
    participants: [],
    detail: null,
    relevance: 'mention',
    rendering: { icon: 'mention', category: 'social' },
    createdAt: '2026-06-29T12:00:00.000Z',
    ...over,
  });
}

describe('toRow', () => {
  it('flattens the wire DTO', () => {
    const r = toRow(event());
    expect(r.system).toBe('linear');
    expect(r.actorName).toBe('Maya');
    expect(r.entityKind).toBe('work_item');
    expect(r.entityTitle).toBe('Ship the beta');
    expect(r.origin).toBe('external');
  });
});

describe('streamDescription', () => {
  it('composes {actor} {verb} {subject}', () => {
    expect(streamDescription(toRow(event()))).toBe('Maya mentioned you in Ship the beta');
  });

  it('falls back to the title when there is no entity', () => {
    const r = toRow(event({ entity: null, title: 'Workspace went live' }));
    expect(streamDescription(r)).toBe('Workspace went live');
  });
});

describe('streamHref', () => {
  it('prefers the external permalink', () => {
    expect(streamHref(toRow(event()))).toBe('https://linear.app/acme/issue/ENG-482');
  });

  it('builds an internal route for a docket entity with no permalink', () => {
    const r = toRow(
      event({
        source: { system: 'docket', integrationId: null, externalUrl: null },
        permalink: null,
        entity: {
          kind: 'project',
          source: 'docket',
          externalId: 'p_1',
          title: 'Billing',
          url: null,
          docketEntityId: 'p_1',
        },
      }),
    );
    expect(streamHref(r)).toBe(`/orgs/${ORG}/projects/p_1`);
  });

  it('returns null for an external event with no permalink', () => {
    const r = toRow(
      event({
        source: { system: 'linear', integrationId: INT, externalUrl: null },
        permalink: null,
        entity: null,
      }),
    );
    expect(streamHref(r)).toBeNull();
  });
});

describe('kindGlyph', () => {
  it('maps completion to the completed tone', () => {
    expect(kindGlyph('completed').tone).toContain('completed');
  });
});
