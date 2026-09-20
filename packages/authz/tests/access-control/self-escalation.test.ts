import { describe, expect, it } from 'vitest';
import { noSelfEscalation, SelfEscalationError } from '../../src/write-guards';

describe('noSelfEscalation', () => {
  it('allows granting at or below the writer’s own rank', () => {
    expect(() => {
      noSelfEscalation('manage', 'manage');
    }).not.toThrow();
    expect(() => {
      noSelfEscalation('manage', 'view');
    }).not.toThrow();
  });

  it('throws when granting above the writer’s own rank', () => {
    expect(() => {
      noSelfEscalation('contribute', 'manage');
    }).toThrow(SelfEscalationError);
  });

  it('SelfEscalationError carries a default message and name', () => {
    const err = new SelfEscalationError();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('SelfEscalationError');
    expect(err.message).toMatch(/above your own/);
  });
});
