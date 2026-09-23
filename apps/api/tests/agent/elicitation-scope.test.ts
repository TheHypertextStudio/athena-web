/** The provenance the agent loop declares when it materializes a turn's questions. */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { materializeSessionElicitations } from '../../src/agent/elicitation-scope';
import {
  appProvenance,
  currentProvenance,
  type ProvenanceBase,
  runWithProvenance,
} from '../../src/lib/provenance/context';
import type { SessionRow } from '../../src/routes/agent-session-helpers';
import * as elicitationService from '../../src/services/elicitation-service';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Materialize for `session` and report the provenance the questions were raised under. */
async function scopeSeenFor(session: Partial<SessionRow>): Promise<ProvenanceBase | null> {
  let seen: ProvenanceBase | null = null;
  vi.spyOn(elicitationService, 'materializeElicitations').mockImplementation(async () => {
    seen = currentProvenance();
    return [];
  });
  await materializeSessionElicitations({ id: 'ses_1', ...session } as SessionRow);
  return seen;
}

describe('materializeSessionElicitations', () => {
  it('raises a delegated job’s questions as Athena in that session', async () => {
    expect(await scopeSeenFor({ executorKind: 'athena', kind: 'job' })).toEqual({
      channel: 'athena',
      surface: 'session',
      performer: { kind: 'athena', name: 'Athena' },
      sessionId: 'ses_1',
    });
  });

  it('raises a conversation’s questions as Athena in chat', async () => {
    expect(await scopeSeenFor({ executorKind: 'athena', kind: 'chat' })).toMatchObject({
      channel: 'athena',
      surface: 'chat',
      sessionId: 'ses_1',
    });
  });

  it('leaves a registered agent’s questions under the scope already in flight', async () => {
    const seen = await runWithProvenance(appProvenance(), () =>
      scopeSeenFor({ executorKind: 'registered_agent', kind: 'job' }),
    );
    expect(seen).toEqual(appProvenance());
  });
});
