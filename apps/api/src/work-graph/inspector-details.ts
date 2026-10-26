/** Inspector provenance is projected from authorized saved endpoints, never reconstructed from arrows. */
import type { GraphData, GraphSnapshot, GraphWork } from './contract';
import { graphContext } from './discovery';
import { isDependency } from './selection';

type Detail = GraphSnapshot['details'][number];
type Entry = Detail['incoming']['items'][number];

function representative(
  key: string,
  shown: ReadonlySet<string>,
  parents: ReadonlyMap<string, string>,
): string | undefined {
  const seen = new Set<string>();
  let current: string | undefined = key;
  while (current && !seen.has(current)) {
    if (shown.has(current)) return current;
    seen.add(current);
    current = parents.get(current);
  }
  return undefined;
}

function addEntry(
  detail: Detail | undefined,
  direction: 'incoming' | 'outgoing',
  entry: Entry,
): void {
  if (!detail) return;
  detail[direction].total++;
  if (detail[direction].items.length < 10) detail[direction].items.push(entry);
}

/** Resolve each displayed identity's original relationships and bounded, authorized ancestor context. */
export function inspectorDetails(
  data: GraphData,
  shown: ReadonlySet<string>,
  edges: GraphSnapshot['edges'],
  parents: ReadonlyMap<string, string>,
  root: string,
): GraphSnapshot['details'] {
  const byKey = new Map(data.nodes.map((n) => [n.key, n]));
  const result = new Map<string, Detail>(
    [...shown].map((key) => [
      key,
      {
        key,
        ...graphContext(key, parents, byKey, root),
        incoming: { total: 0, items: [] },
        outgoing: { total: 0, items: [] },
      },
    ]),
  );
  const entry = (work: GraphWork, kind: Entry['kind'], via?: GraphWork): Entry => ({
    work,
    kind,
    ...graphContext(work.key, parents, byKey, root),
    ...(via ? { via } : {}),
  });
  const aggregated = new Set(
    edges.filter((e) => e.aggregated).map((e) => `${e.kind}:${e.source}>${e.target}`),
  );
  for (const relation of data.relations.filter(isDependency)) {
    const source = byKey.get(relation.source),
      target = byKey.get(relation.target);
    if (!source || !target) continue;
    const kind = relation.kind as Entry['kind'];
    addEntry(result.get(source.key), 'outgoing', entry(target, kind));
    addEntry(result.get(target.key), 'incoming', entry(source, kind));
    const a = representative(source.key, shown, parents),
      b = representative(target.key, shown, parents);
    if (!a || !b || !aggregated.has(`${kind}:${a}>${b}`)) continue;
    if (a !== source.key) addEntry(result.get(a), 'outgoing', entry(target, kind, source));
    if (b !== target.key) addEntry(result.get(b), 'incoming', entry(source, kind, target));
  }
  return [...result.values()];
}
