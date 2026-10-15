import type { initiative } from '@docket/db';
import { deferAfterResponse } from '../lib/after-response';
import { enqueueSearchUpsert } from '../search/write-through';
import { emitEvent } from './event-emit';

/** Stamp creation once, then defer its feed and search effects until the response is sent. */
export function deferInitiativeCreated(
  row: Pick<typeof initiative.$inferSelect, 'id' | 'name' | 'organizationId'>,
  actorId: string,
): void {
  const orgId = row.organizationId;
  const occurredAt = new Date();
  deferAfterResponse('initiative-created-event', () =>
    emitEvent({
      organizationId: orgId,
      kind: 'created',
      actorId,
      occurredAt,
      title: row.name,
      subject: { type: 'initiative', id: row.id, title: row.name },
    }),
  );
  deferAfterResponse('initiative-created-search-upsert', () =>
    enqueueSearchUpsert(orgId, 'initiative', row.id),
  );
}
