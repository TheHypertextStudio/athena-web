import { describe, expect, it } from 'vitest';

import { MockObserver } from '../../src/mock-observer';

const observer = new MockObserver();
const AT = '2026-06-28T12:00:00.000Z';

describe('MockObserver.verifySignature', () => {
  it('accepts any present signature except the literal "invalid"', () => {
    expect(
      observer.verifySignature({ rawBody: '{}', headers: { 'linear-signature': 'abc' } }),
    ).toBe(true);
  });

  it('rejects a missing or explicitly-invalid signature (for route tests)', () => {
    expect(observer.verifySignature({ rawBody: '{}', headers: {} })).toBe(false);
    expect(
      observer.verifySignature({ rawBody: '{}', headers: { 'linear-signature': 'invalid' } }),
    ).toBe(false);
  });
});

describe('MockObserver.route + normalize', () => {
  it('routes a Linear-shaped payload', () => {
    const r = observer.route({ type: 'Issue', organizationId: 'ws_1', id: 'iss_1' });
    expect(r?.externalWorkspaceId).toBe('ws_1');
    expect(r?.eventType).toBe('Issue');
    expect(r?.externalEventId).toBe('mock:Issue:iss_1');
  });

  it('falls back to deterministic defaults for a bare payload', () => {
    const r = observer.route({});
    expect(r?.externalWorkspaceId).toBe('mock-workspace');
    expect(r?.eventType).toBe('mock');
  });

  it('honors an explicit externalEventId override', () => {
    const r = observer.route({ externalEventId: 'evt_custom_1' });
    expect(r?.externalEventId).toBe('evt_custom_1');
  });

  it('returns null for a non-object payload', () => {
    expect(observer.route('not-an-object')).toBeNull();
    expect(observer.route(null)).toBeNull();
  });

  it('normalizes one draft, honoring fixture overrides', () => {
    const drafts = observer.normalize({
      eventType: 'mock',
      receivedAt: AT,
      payload: { kind: 'assignment', title: 'Fixture title', occurredAt: AT, id: 'x1' },
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.kind).toBe('assignment');
    expect(drafts[0]?.title).toBe('Fixture title');
    expect(drafts[0]?.occurredAt).toBe(AT);
    expect(drafts[0]?.entity).toEqual({
      kind: 'work_item',
      externalId: 'x1',
      title: 'Fixture title',
    });
    expect(drafts[0]?.detail).toEqual({
      schema: 'generic',
      title: 'Fixture title',
      summary: null,
      url: null,
    });
  });

  it('defaults kind to mention when unspecified', () => {
    const drafts = observer.normalize({ eventType: 'mock', receivedAt: AT, payload: {} });
    expect(drafts[0]?.kind).toBe('mention');
    expect(drafts[0]?.title).toBe('Mock observation');
    expect(drafts[0]?.entity).toBeUndefined();
    expect(drafts[0]?.detail?.schema).toBe('generic');
  });

  it('tolerates a non-object payload, falling back to the bare-payload defaults', () => {
    const drafts = observer.normalize({ eventType: 'mock', receivedAt: AT, payload: 'garbage' });
    expect(drafts[0]?.title).toBe('Mock observation');
    expect(drafts[0]?.dedupeKey).toBe('mock:mock:0');
  });

  it('builds an entity without a title when the fixture carries an id but no title', () => {
    const drafts = observer.normalize({ eventType: 'mock', receivedAt: AT, payload: { id: 'x2' } });
    expect(drafts[0]?.entity).toEqual({ kind: 'work_item', externalId: 'x2' });
  });

  it('carries a fixture summary into the draft and its generic detail', () => {
    const drafts = observer.normalize({
      eventType: 'mock',
      receivedAt: AT,
      payload: { summary: 'Fixture summary' },
    });
    expect(drafts[0]?.summary).toBe('Fixture summary');
    expect(drafts[0]?.detail).toMatchObject({ summary: 'Fixture summary' });
  });

  it('maps a bare-string participants array to actor refs', () => {
    const drafts = observer.normalize({
      eventType: 'mock',
      receivedAt: AT,
      payload: { participants: ['u1', 'u2'] },
    });
    expect(drafts[0]?.participants).toEqual([{ externalId: 'u1' }, { externalId: 'u2' }]);
  });

  it('maps object-shaped participants, dropping ones without an externalId', () => {
    const drafts = observer.normalize({
      eventType: 'mock',
      receivedAt: AT,
      payload: { participants: [{ externalId: 'u3' }, { nope: true }, 42] },
    });
    expect(drafts[0]?.participants).toEqual([{ externalId: 'u3' }]);
  });

  it('omits participants entirely when the fixture array is empty or absent', () => {
    const withKey = observer.normalize({
      eventType: 'mock',
      receivedAt: AT,
      payload: { participants: [] },
    });
    expect(withKey[0]).not.toHaveProperty('participants');
  });
});
