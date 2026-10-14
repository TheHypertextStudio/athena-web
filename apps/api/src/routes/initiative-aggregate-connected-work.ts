/**
 * Assemble one Initiative's connected work from the Program and Project links already loaded for
 * its rollup.
 *
 * @remarks
 * The aggregate route loads every link for `[id, ...descendantIds]` in one pass, so the same
 * Program or Project can arrive more than once — once directly and once through a descendant. A
 * direct link always wins, and among indirect ones the first seen stands. Lives beside the route
 * rather than in it because the route's handler is long enough without two near-identical loops.
 */
import { type Health } from '@docket/work/capability-contract';
import type { InitiativeAggregateDetail } from '@docket/work/initiative-contract';
import type { z } from 'zod';

import { resourceAccessKey } from '../permissions/resource-access';

/** One assembled connected-work entry, in the shape the aggregate response validates. */
type ConnectedWorkEntry = z.input<typeof InitiativeAggregateDetail>['connectedWork'][number];

/** The columns a Program or Project row contributes to an entry. */
interface ConnectedWorkRow {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly summary: string | null;
  readonly status: string;
  readonly health: Health | null;
  /** Present on a Project row; a Program is the container, never contained. */
  readonly programId?: string | null;
}

/** One rollup Initiative's link to the Program or Project it names. */
export interface ConnectedWorkLink<TRow extends ConnectedWorkRow> {
  readonly initiativeId: string;
  readonly row: TRow;
}

/** What {@link aggregateConnectedWork} needs beyond the links themselves. */
export interface AggregateConnectedWorkInput {
  /** The Initiative the aggregate is rooted at; a link from it is direct. */
  readonly id: string;
  /** The resources the caller may see, keyed by {@link resourceAccessKey}. */
  readonly accessibleWorkKeys: ReadonlySet<string>;
  /** The first hop below `id` an indirect link inherited through, or `null` when direct. */
  readonly inheritedThroughInitiativeId: (initiativeId: string) => string | null;
  readonly programLinks: readonly ConnectedWorkLink<ConnectedWorkRow>[];
  readonly projectLinks: readonly ConnectedWorkLink<ConnectedWorkRow>[];
}

/** Fold one kind's links into the accumulating map, keeping the strongest link per resource. */
function collectKind(
  kind: 'program' | 'project',
  links: readonly ConnectedWorkLink<ConnectedWorkRow>[],
  into: Map<string, ConnectedWorkEntry>,
  input: AggregateConnectedWorkInput,
): void {
  for (const item of links) {
    const accessKey = resourceAccessKey({
      organizationId: item.row.organizationId,
      kind,
      id: item.row.id,
    });
    if (!input.accessibleWorkKeys.has(accessKey)) continue;

    const key = `${kind}:${item.row.id}`;
    const direct = item.initiativeId === input.id;
    const existing = into.get(key);
    if (existing?.direct || (existing && !direct)) continue;

    into.set(key, {
      kind,
      id: item.row.id,
      organizationId: item.row.organizationId,
      name: item.row.name,
      summary: item.row.summary,
      status: item.row.status,
      health: item.row.health,
      direct,
      inheritedThroughInitiativeId: input.inheritedThroughInitiativeId(item.initiativeId),
      programId: kind === 'program' ? null : (item.row.programId ?? null),
    });
  }
}

/**
 * Build the Initiative's connected-work rows.
 *
 * @param input - See {@link AggregateConnectedWorkInput}.
 * @returns the entries, Programs first, then Projects. Mutable, because the aggregate response
 *   builder partitions it in place by kind.
 */
export function aggregateConnectedWork(input: AggregateConnectedWorkInput): ConnectedWorkEntry[] {
  const connectedByKey = new Map<string, ConnectedWorkEntry>();
  collectKind('program', input.programLinks, connectedByKey, input);
  collectKind('project', input.projectLinks, connectedByKey, input);
  return [...connectedByKey.values()];
}
