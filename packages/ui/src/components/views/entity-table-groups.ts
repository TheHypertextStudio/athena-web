import type * as React from 'react';

/** Shared fields for one typed table continuation entry. */
export interface EntityTableContinuationBase {
  /** Stable DOM and flattened-entry identity. */
  readonly id: string;
  /** Application-owned visible action label. */
  readonly label: string;
}

/** A page continuation that is actionable or already loading. */
export type EntityTableContinuation = EntityTableContinuationBase &
  (
    | {
        readonly state: 'idle' | 'error';
        readonly onActivate: () => void;
      }
    | {
        readonly state: 'loading';
        readonly onActivate?: never;
      }
  );

/** Shared fields for one nested table group. */
export interface EntityTableGroupBase {
  /** Encoded full group path used for collapse and flattened identity. */
  readonly id: string;
  /** Display-ready group label. */
  readonly label: string;
  /** Optional leading decoration for the group header. */
  readonly decoration?: React.ReactNode;
  /** Authoritative server count. */
  readonly count?: number;
  /** Continuation owned by this exact group path. */
  readonly continuation?: EntityTableContinuation;
}

/** One leaf group of rows or one branch group of nested children. */
export type EntityTableGroup<T> = EntityTableGroupBase &
  (
    | { readonly rows: readonly T[]; readonly children?: never }
    | { readonly children: readonly EntityTableGroup<T>[]; readonly rows?: never }
  );

/** One keyboard-addressable entry in a flattened entity table. */
export type FlatEntityTableEntry<T> =
  | {
      readonly kind: 'group';
      readonly key: string;
      readonly group: EntityTableGroup<T>;
      readonly level: number;
      readonly count: number;
    }
  | {
      readonly kind: 'row';
      readonly key: string;
      readonly row: T;
      readonly groupId?: string;
    }
  | {
      readonly kind: 'continuation';
      readonly key: string;
      readonly continuation: EntityTableContinuation;
      readonly groupId?: string;
      readonly level: number;
    };

/** Inputs for {@link flattenEntityTableEntries}. */
export interface FlattenEntityTableEntriesOptions<T> {
  readonly rows?: readonly T[] | undefined;
  readonly groups?: readonly EntityTableGroup<T>[] | undefined;
  readonly continuation?: EntityTableContinuation | undefined;
  readonly collapsed: ReadonlySet<string>;
  readonly getRowKey: (row: T) => string;
}

/** Return the displayed count for one group when the server did not provide one. */
function groupCount<T>(group: EntityTableGroup<T>): number {
  if (group.count !== undefined) return group.count;
  if (group.rows !== undefined) return group.rows.length;
  return group.children.reduce((count, child) => count + groupCount(child), 0);
}

/** Append a group and its expanded descendants in server order. */
function appendGroup<T>(
  entries: FlatEntityTableEntry<T>[],
  group: EntityTableGroup<T>,
  level: number,
  collapsed: ReadonlySet<string>,
  getRowKey: (row: T) => string,
): void {
  entries.push({ kind: 'group', key: `g:${group.id}`, group, level, count: groupCount(group) });
  if (collapsed.has(group.id)) return;

  if (group.rows !== undefined) {
    for (const row of group.rows) {
      entries.push({
        kind: 'row',
        key: `r:${group.id}:${encodeURIComponent(getRowKey(row))}`,
        row,
        groupId: group.id,
      });
    }
  } else {
    for (const child of group.children) {
      appendGroup(entries, child, level + 1, collapsed, getRowKey);
    }
  }

  if (group.continuation !== undefined) {
    entries.push({
      kind: 'continuation',
      key: `c:${group.id}:${encodeURIComponent(group.continuation.id)}`,
      continuation: group.continuation,
      groupId: group.id,
      level,
    });
  }
}

/**
 * Flatten groups, rows, and typed continuations into one keyboard and virtualization sequence.
 *
 * @param options - The server-ordered source and current collapse state.
 * @returns the visible entries in render order.
 */
export function flattenEntityTableEntries<T>({
  rows,
  groups,
  continuation,
  collapsed,
  getRowKey,
}: FlattenEntityTableEntriesOptions<T>): FlatEntityTableEntry<T>[] {
  const entries: FlatEntityTableEntry<T>[] = [];
  if (groups !== undefined) {
    for (const group of groups) appendGroup(entries, group, 0, collapsed, getRowKey);
  } else {
    for (const row of rows ?? []) {
      entries.push({ kind: 'row', key: `r:${encodeURIComponent(getRowKey(row))}`, row });
    }
  }

  if (continuation !== undefined) {
    entries.push({
      kind: 'continuation',
      key: `c:root:${encodeURIComponent(continuation.id)}`,
      continuation,
      level: 0,
    });
  }
  return entries;
}
