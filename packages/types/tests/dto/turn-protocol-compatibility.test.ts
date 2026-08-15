import {
  TurnContentBlock as DomainTurnContentBlock,
  TurnMessage as DomainTurnMessage,
} from '@docket/athena/turn-protocol';
import {
  TurnContentBlock as LegacyTurnContentBlock,
  TurnMessage as LegacyTurnMessage,
} from '@docket/types';
import { describe, expect, it } from 'vitest';

describe('durable Athena turn protocol compatibility', () => {
  it('re-exports the domain-owned schemas without creating a second grammar', () => {
    expect(LegacyTurnContentBlock).toBe(DomainTurnContentBlock);
    expect(LegacyTurnMessage).toBe(DomainTurnMessage);
  });
});
