/** Provider-neutral calendar source-subscription removal. */
import {
  calendarConnection,
  calendarItem,
  calendarItemWrite,
  calendarLayer,
  type Database,
} from '@docket/db';
import { CalendarProvider } from '@docket/planning/calendar-contract';
import { and, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm';

import { ApiError, NotFoundError, ReauthRequiredError } from '../error';
import {
  CalendarReauthRequiredError,
  softRemoveProviderLayer,
  type CalendarProviderAdapter,
  type CalendarProviderCredentials,
  type CalendarProviderSyncModule,
} from '../routes/calendar-sync-engine';

/** Provider modules available to source-subscription removal. */
export type CalendarSourceRemovalModules = Partial<
  Record<CalendarProvider, CalendarProviderSyncModule>
>;

function sourceRemovalProblem(
  status: 409 | 503,
  code:
    | 'calendar_source_scope_required'
    | 'calendar_source_protected'
    | 'calendar_source_writes_pending'
    | 'calendar_source_removal_failed',
  message: string,
): ApiError {
  return new ApiError(status, code, message);
}

async function sourceHasPendingWork(
  db: Database,
  userId: string,
  layerId: string,
): Promise<boolean> {
  const [itemRows, writeRows] = await Promise.all([
    db
      .select({ id: calendarItem.id })
      .from(calendarItem)
      .where(
        and(
          eq(calendarItem.userId, userId),
          eq(calendarItem.layerId, layerId),
          isNull(calendarItem.archivedAt),
          or(
            inArray(calendarItem.syncState, ['local_dirty', 'push_pending', 'conflict']),
            isNotNull(calendarItem.conflict),
          ),
        ),
      )
      .limit(1),
    db
      .select({ id: calendarItemWrite.id })
      .from(calendarItemWrite)
      .innerJoin(calendarItem, eq(calendarItem.id, calendarItemWrite.calendarItemId))
      .where(
        and(
          eq(calendarItemWrite.userId, userId),
          eq(calendarItem.layerId, layerId),
          inArray(calendarItemWrite.status, ['pending', 'conflict']),
        ),
      )
      .limit(1),
  ]);
  return itemRows.length > 0 || writeRows.length > 0;
}

interface RemovableSourceTarget {
  readonly layer: typeof calendarLayer.$inferSelect & { readonly externalLayerId: string };
  readonly connection: typeof calendarConnection.$inferSelect;
}

async function requireRemovableSource(
  db: Database,
  userId: string,
  layerId: string,
): Promise<RemovableSourceTarget> {
  const rows = await db
    .select({ layer: calendarLayer, connection: calendarConnection })
    .from(calendarLayer)
    .innerJoin(calendarConnection, eq(calendarConnection.id, calendarLayer.connectionId))
    .where(
      and(
        eq(calendarLayer.id, layerId),
        eq(calendarLayer.userId, userId),
        eq(calendarConnection.userId, userId),
        isNull(calendarLayer.removedAt),
      ),
    )
    .limit(1);
  const target = rows[0];
  if (!target?.layer.externalLayerId) throw new NotFoundError('Calendar source not found');
  if (
    target.layer.primary ||
    target.layer.sourceRelationship === 'owned' ||
    target.layer.sourceManagement?.canRemoveSubscription !== true
  ) {
    throw sourceRemovalProblem(
      409,
      'calendar_source_protected',
      'This calendar source cannot be removed from its account',
    );
  }
  return {
    layer: { ...target.layer, externalLayerId: target.layer.externalLayerId },
    connection: target.connection,
  };
}

function requireSourceRemovalModule(
  modules: CalendarSourceRemovalModules,
  providerValue: string,
): {
  readonly module: CalendarProviderSyncModule;
  readonly remove: NonNullable<CalendarProviderAdapter['removeSourceSubscription']>;
} {
  const provider = CalendarProvider.safeParse(providerValue);
  if (!provider.success) {
    throw sourceRemovalProblem(
      503,
      'calendar_source_removal_failed',
      'Calendar provider is not available for source removal',
    );
  }
  const module = modules[provider.data];
  const remove = module?.adapter.removeSourceSubscription;
  if (!module || typeof remove !== 'function') {
    throw sourceRemovalProblem(
      409,
      'calendar_source_protected',
      'This calendar provider does not support source removal',
    );
  }
  return { module, remove };
}

async function resolveRemovalCredentials(
  db: Database,
  input: {
    readonly userId: string;
    readonly externalAccountId: string;
    readonly module: CalendarProviderSyncModule;
  },
): Promise<CalendarProviderCredentials> {
  const discovered = await input.module.discoverConnections({ db, userId: input.userId });
  const account = discovered.find(
    (candidate) => candidate.externalAccountId === input.externalAccountId,
  );
  if (!account) throw new NotFoundError('Linked calendar account not found');
  try {
    return await input.module.resolveCredentials(account);
  } catch (error) {
    if (error instanceof CalendarReauthRequiredError) {
      throw new ReauthRequiredError('Reconnect the calendar account before removing this source');
    }
    throw sourceRemovalProblem(
      503,
      'calendar_source_removal_failed',
      'Calendar provider credentials could not be resolved',
    );
  }
}

async function removeSourceAtProvider(
  remove: NonNullable<CalendarProviderAdapter['removeSourceSubscription']>,
  credentials: CalendarProviderCredentials,
  externalLayerId: string,
): Promise<void> {
  let result;
  try {
    result = await remove({ credentials, externalLayerId });
  } catch {
    throw sourceRemovalProblem(
      503,
      'calendar_source_removal_failed',
      'Calendar provider did not confirm source removal',
    );
  }
  if (result.outcome === 'reauth') {
    throw new ReauthRequiredError('Reconnect the calendar account before removing this source');
  }
  if (result.outcome !== 'applied') {
    throw sourceRemovalProblem(
      503,
      'calendar_source_removal_failed',
      'Calendar provider did not confirm source removal',
    );
  }
}

/**
 * Remove one non-owned provider calendar from the linked account's source list.
 *
 * @throws {NotFoundError} When the active layer does not belong to the current user or account.
 * @throws {ApiError} When the source is protected, has pending work, lacks consent, or the
 * provider does not confirm removal.
 */
export async function removeCalendarSourceSubscription(
  db: Database,
  input: {
    readonly userId: string;
    readonly layerId: string;
    readonly modules: CalendarSourceRemovalModules;
    readonly now?: Date;
  },
): Promise<void> {
  const target = await requireRemovableSource(db, input.userId, input.layerId);
  if (await sourceHasPendingWork(db, input.userId, input.layerId)) {
    throw sourceRemovalProblem(
      409,
      'calendar_source_writes_pending',
      'Resolve pending writes and conflicts before removing this calendar source',
    );
  }
  if (target.connection.scopeState?.sourceManagement !== true) {
    throw sourceRemovalProblem(
      409,
      'calendar_source_scope_required',
      'Calendar source removal requires incremental provider consent',
    );
  }
  const operation = requireSourceRemovalModule(input.modules, target.connection.provider);
  const credentials = await resolveRemovalCredentials(db, {
    userId: input.userId,
    externalAccountId: target.connection.externalAccountId,
    module: operation.module,
  });
  await removeSourceAtProvider(operation.remove, credentials, target.layer.externalLayerId);

  await softRemoveProviderLayer(db, {
    layerId: target.layer.id,
    credentials,
    adapter: operation.module.adapter,
    now: input.now ?? new Date(),
  });
}
