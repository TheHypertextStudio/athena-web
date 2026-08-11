import { describe, expect, it } from 'vitest';

import { type StreamEventOut as StreamEventOutType, StreamEventOut } from '@docket/types';

import {
  kindGlyph,
  streamActorLabel,
  streamDescription,
  streamEventDetailLabel,
  streamEventSentence,
  streamHref,
  toRow,
} from '@/components/stream/stream-meta';

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
    actorIsViewer: false,
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
    expect(r.actorExternalId).toBe('u_maya');
    expect(r.actorIsViewer).toBe(false);
  });
});

describe('viewer-aware event copy', () => {
  it('uses You only from the explicit viewer relationship', () => {
    const mine = toRow(event({ actorIsViewer: true }));
    expect(streamActorLabel(mine)).toBe('You');
    expect(streamEventSentence({ ...mine, kind: 'completed' })).toBe('You completed the task');
  });

  it('describes a viewer assigning themself without saying You assigned you', () => {
    const mine = toRow(event({ actorIsViewer: true, kind: 'assignment' }));
    expect(streamEventSentence(mine)).toBe('You assigned yourself');
    expect(streamDescription(mine)).toBe('You assigned yourself to Ship the beta');
  });

  it('keeps another person’s complete preferred display name', () => {
    const other = toRow(
      event({
        actor: {
          source: 'linear',
          externalId: 'u_willie',
          displayName: 'Willie Chalmers III',
          avatarUrl: null,
          docketActorId: null,
        },
      }),
    );
    expect(streamActorLabel(other)).toBe('Willie Chalmers III');
  });

  it('uses a known email sender instead of Someone', () => {
    const email = toRow(
      event({
        actor: null,
        kind: 'email_received',
        detail: {
          schema: 'docket.inbound_email',
          messageId: 'message-1',
          threadId: null,
          fromAddress: 'maya@example.com',
          fromName: 'Maya',
          subject: 'Launch copy',
          snippet: 'Ready for review',
          hasAttachments: false,
          capturedEntityKind: null,
          capturedEntityId: null,
        },
      }),
    );
    expect(streamEventSentence(email)).toBe('Maya sent an email');
  });

  it('renders application-owned before and after labels', () => {
    const changed = toRow(
      event({
        kind: 'field_change',
        detail: {
          schema: 'docket.field_change',
          fields: ['dueDate'],
          changes: [{ field: 'dueDate', label: 'Due date', from: 'Aug 10', to: 'Aug 12' }],
        },
      }),
    );
    expect(streamEventDetailLabel(changed)).toBe('Due date: Aug 10 → Aug 12');
  });

  it('formats stored ISO date values without exposing their machine representation', () => {
    const changed = toRow(
      event({
        kind: 'field_change',
        detail: {
          schema: 'docket.field_change',
          fields: ['dueDate'],
          changes: [{ field: 'dueDate', label: 'Due date', from: null, to: '2026-08-19' }],
        },
      }),
    );
    expect(streamEventDetailLabel(changed)).toBe('Due date: None → Aug 19, 2026');
  });

  it('humanizes canonical state values', () => {
    const changed = toRow(
      event({
        kind: 'status_change',
        detail: {
          schema: 'docket.state_change',
          fromState: 'in_progress',
          toState: 'done',
        },
      }),
    );
    expect(streamEventDetailLabel(changed)).toBe('In progress → Done');
  });

  it('does not pretend an unknown prior state was empty', () => {
    const changed = toRow(
      event({
        kind: 'status_change',
        detail: { schema: 'docket.state_change', fromState: null, toState: 'active' },
      }),
    );
    expect(streamEventDetailLabel(changed)).toBe('Now Active');
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
