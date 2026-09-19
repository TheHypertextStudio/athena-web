/** Batch size that keeps a generated `or(...)` predicate inside Postgres' parameter budget. */
const DEFAULT_BATCH_SIZE = 250;

/** Split a list into fixed-size batches so one statement never carries too many parameters. */
export function inBatches<T>(items: readonly T[], size: number = DEFAULT_BATCH_SIZE): T[][] {
  const batches: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size) {
    batches.push(items.slice(offset, offset + size));
  }
  return batches;
}
