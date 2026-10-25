import type { Database } from '@docket/db';
import { getTableName, is, Table } from 'drizzle-orm';

/** One builder call recorded on a fake query chain, such as `set` or `values`. */
export interface RecordedQueryStep {
  readonly method: string;
  readonly args: readonly unknown[];
}

/** One top-level query issued against the fake database. */
export interface RecordedQuery {
  readonly operation: 'select' | 'insert' | 'update' | 'delete';
  /** Table named by `from(...)` for selects or by the operation itself for writes. */
  readonly table: string | undefined;
  readonly steps: RecordedQueryStep[];
}

/** Chooses the rows for one query when it is awaited, after every builder call is recorded. */
export type QueryRouter = (query: RecordedQuery) => unknown;

/** Transaction handle passed to `database.transaction` callbacks. */
export type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Fake Drizzle database whose queries resolve to queued or routed results. */
export interface QueryFake {
  readonly database: Database;
  /** The same fake, typed as the transaction handle callers receive inside `transaction`. */
  readonly transaction: DatabaseTransaction;
  readonly queries: RecordedQuery[];
  /** Arguments of one builder method across queries of one operation, in issue order. */
  stepsOf(operation: RecordedQuery['operation'], method: string): (readonly unknown[])[];
}

function tableOf(steps: readonly RecordedQueryStep[]): string | undefined {
  const source =
    steps[0]?.method === 'select'
      ? steps.find((step) => step.method === 'from')?.args[0]
      : steps[0]?.args[0];
  return is(source, Table) ? getTableName(source) : undefined;
}

function recordedQuery(operation: RecordedQuery['operation'], steps: RecordedQueryStep[]) {
  return {
    operation,
    steps,
    get table() {
      return tableOf(steps);
    },
  } satisfies RecordedQuery;
}

function chain(resolveResult: () => unknown, steps: RecordedQueryStep[]): unknown {
  const proxy: unknown = new Proxy(() => undefined, {
    get(_target, property) {
      if (property === 'then') {
        return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          new Promise((settle) => {
            settle(resolveResult());
          })
            .then((result) => (result instanceof Error ? Promise.reject(result) : result))
            .then(resolve, reject);
      }
      return (...args: unknown[]) => {
        steps.push({ method: String(property), args });
        return proxy;
      };
    },
  });
  return proxy;
}

/**
 * Build a fake database for code that only composes Drizzle builders and awaits their rows.
 * With an array, each `select`/`insert`/`update`/`delete` takes the next queued result; with a
 * router, the router picks each result from the recorded query. An `Error` result rejects.
 * `transaction(callback)` runs the callback against the same fake.
 */
export function queryFake(results: readonly unknown[] | QueryRouter): QueryFake {
  const pending = typeof results === 'function' ? [] : [...results];
  const queries: RecordedQuery[] = [];
  const start =
    (operation: RecordedQuery['operation']) =>
    (...args: unknown[]): unknown => {
      const steps: RecordedQueryStep[] = [{ method: operation, args }];
      const query = recordedQuery(operation, steps);
      queries.push(query);
      if (typeof results === 'function') return chain(() => results(query), steps);
      if (pending.length === 0) throw new Error(`Unexpected ${operation} query`);
      const result = pending.shift();
      return chain(() => result, steps);
    };
  const database: Record<string, unknown> = {
    select: start('select'),
    insert: start('insert'),
    update: start('update'),
    delete: start('delete'),
  };
  database['transaction'] = (callback: (tx: unknown) => unknown) =>
    Promise.resolve(callback(database));
  return {
    database: database as unknown as Database,
    transaction: database as unknown as DatabaseTransaction,
    queries,
    stepsOf: (operation, method) =>
      queries
        .filter((query) => query.operation === operation)
        .flatMap((query) => query.steps.filter((step) => step.method === method))
        .map((step) => step.args),
  };
}

/** Fake database that routes each query to its table's rows; unrouted tables have no rows. */
export function routedQueryFake(routes: Readonly<Record<string, unknown>>): QueryFake {
  return queryFake((query) => (query.table && query.table in routes ? routes[query.table] : []));
}
