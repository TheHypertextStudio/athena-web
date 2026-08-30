import type { agentSession } from '@docket/db';

import { ConflictError } from '../error';

/** Keep durable Lattice sessions out of every hosted Athena execution path. */
export function assertHostedExecutionSurface(session: typeof agentSession.$inferSelect): void {
  if (session.executionSurface === 'lattice') {
    throw new ConflictError('Lattice assignment sessions run through the delegation scheduler');
  }
}
