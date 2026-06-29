import { describe, expect, it } from 'vitest';

import { MockObserver } from '../../src/mock/observer';

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
  });

  it('defaults kind to mention when unspecified', () => {
    const drafts = observer.normalize({ eventType: 'mock', receivedAt: AT, payload: {} });
    expect(drafts[0]?.kind).toBe('mention');
    expect(drafts[0]?.title).toBe('Mock observation');
  });
});
