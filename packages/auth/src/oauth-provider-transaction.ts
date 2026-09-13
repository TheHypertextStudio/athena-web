/** Better Auth adapters bound to Docket's transaction and row-lock coordinator. */
import type { AuthEndpointContext } from '@better-auth/core/context';
import type { DBAdapter, DBTransactionAdapter } from '@better-auth/core/db/adapter';
import { db, oauthClient, oauthJwtRevocation } from '@docket/db';
import type { BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { eq } from 'drizzle-orm';

import {
  DOCKET_AUTH_DATABASE_SCHEMA,
  type ProviderEndpointInput,
  savepointState,
} from './oauth-provider-types';

type TraceableAdapter = DBAdapter | DBTransactionAdapter;
type AdapterTraceKind = 'base' | 'savepoint' | 'transaction';
type AdapterTraceObserver = (entry: {
  readonly adapter: object;
  readonly kind: AdapterTraceKind;
  readonly method: string;
  readonly model?: string;
}) => void;

const adapterTraceSymbol = Symbol.for('docket:test:oauth-adapter-trace');
const tracedMethods = new Set([
  'count',
  'create',
  'delete',
  'deleteMany',
  'findMany',
  'findOne',
  'update',
  'updateMany',
]);

// The PostgreSQL acceptance suite installs this observer for one request. Keeping the hook at the
// adapter boundary proves that Better Auth did not silently fall back to its construction adapter.
function traceAdapter<T extends TraceableAdapter>(adapter: T, kind: AdapterTraceKind): T {
  const observer = Reflect.get(globalThis, adapterTraceSymbol) as AdapterTraceObserver | undefined;
  if (typeof observer !== 'function') return adapter;
  const proxy: T = new Proxy(adapter, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (
        typeof property !== 'string' ||
        !tracedMethods.has(property) ||
        typeof value !== 'function'
      ) {
        return value;
      }
      return (...args: unknown[]) => {
        const input = args[0];
        const model =
          input && typeof input === 'object' && typeof Reflect.get(input, 'model') === 'string'
            ? (Reflect.get(input, 'model') as string)
            : undefined;
        observer({ adapter: proxy, kind, method: property, ...(model ? { model } : {}) });
        return (value as (...parameters: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return proxy;
}

function createAdapterFactory(transaction: boolean): (options: BetterAuthOptions) => DBAdapter {
  const factory = drizzleAdapter(db, {
    provider: 'pg',
    transaction,
    schema: DOCKET_AUTH_DATABASE_SCHEMA,
  });
  return (options: BetterAuthOptions): DBAdapter => traceAdapter(factory(options), 'base');
}

/** Create the Better Auth database adapter with real transaction support enabled. */
export function createDocketAuthDatabase(): (options: BetterAuthOptions) => DBAdapter {
  return createAdapterFactory(true);
}

/** Create the request-local adapter that owns one outer transaction and its savepoints. */
export function coordinatingAdapter(rawOptions: unknown): DBAdapter {
  if (!rawOptions || typeof rawOptions !== 'object') {
    throw new TypeError('Better Auth endpoint context did not include provider options.');
  }
  const options = rawOptions as BetterAuthOptions;
  const base = createAdapterFactory(false)(options);
  return {
    ...base,
    transaction: async <T>(callback: (adapter: DBTransactionAdapter) => Promise<T>) =>
      db.transaction(async (transaction) => {
        const child = traceAdapter(
          drizzleAdapter(transaction, {
            provider: 'pg',
            transaction: false,
            schema: DOCKET_AUTH_DATABASE_SCHEMA,
          })(options),
          'transaction',
        );
        await savepointState.set({
          lockClient: async (clientId) => {
            const rows = await transaction
              .select({ clientId: oauthClient.clientId })
              .from(oauthClient)
              .where(eq(oauthClient.clientId, clientId))
              .for('update');
            return rows.length === 1;
          },
          recordJwtRevocation: async (record) => {
            await transaction
              .insert(oauthJwtRevocation)
              .values(record)
              .onConflictDoNothing({ target: oauthJwtRevocation.tokenDigest });
          },
          run: async <R>(savepointCallback: (adapter: DBTransactionAdapter) => Promise<R>) =>
            transaction.transaction(async (savepoint) => {
              const savepointAdapter = traceAdapter(
                drizzleAdapter(savepoint, {
                  provider: 'pg',
                  transaction: false,
                  schema: DOCKET_AUTH_DATABASE_SCHEMA,
                })(options),
                'savepoint',
              );
              return savepointCallback(savepointAdapter);
            }),
        });
        return callback(child);
      }),
  };
}

/** Rebind a provider endpoint input to the adapter and normalized body owned by its coordinator. */
export function rawInput(
  ctx: AuthEndpointContext,
  adapter: DBAdapter | DBTransactionAdapter,
  body: Record<string, unknown>,
): ProviderEndpointInput {
  return {
    ...ctx,
    body,
    context: { ...ctx.context, adapter },
    asResponse: false,
    returnHeaders: false,
    returnStatus: false,
  } as unknown as ProviderEndpointInput;
}
