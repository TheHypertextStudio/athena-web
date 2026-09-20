import type { NotionMirrorEntity } from '@docket/connections/notion/mirror-contract';
import type { MirrorValue } from '@docket/connections/notion/mirror-values';
import { adoptEntity, applyPulledValues } from './notion-mirror-entities';
import type { MirrorContext } from './notion-mirror-reconcile';

/** Adopt a provider record with its original person identities. */
export async function adoptSourceEntity(
  ctx: MirrorContext,
  entity: NotionMirrorEntity,
  values: Readonly<Record<string, MirrorValue>>,
): Promise<string | undefined> {
  return adoptEntity(ctx.orgId, ctx.actorId, ctx.integrationRow, entity, values);
}

/** Apply an accepted pull and retain native provider assignment information. */
export async function applySourceEntityValues(
  ctx: MirrorContext,
  entity: NotionMirrorEntity,
  id: string,
  values: Readonly<Record<string, MirrorValue>>,
  expectedUpdatedAt?: Date,
): Promise<boolean> {
  return applyPulledValues(
    ctx.orgId,
    {
      actorId: ctx.actorId,
      integrationId: ctx.integrationId,
      ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
    },
    entity,
    id,
    values,
  );
}

/** Read an optional projection revision without duplicating the pull decision's branching. */
export function sourceEntityRevision(record: { updatedAt?: Date } | undefined): Date | undefined {
  return record?.updatedAt;
}
