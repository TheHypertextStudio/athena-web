/** A normalized row from the application catalog or the remote entity search. */
export interface SearchCandidate {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly aliases: readonly string[];
  readonly breadcrumb: readonly string[];
  readonly source: 'catalog' | 'remote';
  readonly sourceRank: number;
}

interface RankedCandidate<T extends SearchCandidate> {
  readonly candidate: T;
  readonly tier: number;
  readonly field: number;
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function subsequence(value: string, query: string): boolean {
  let queryIndex = 0;
  for (let index = 0; index < value.length && queryIndex < query.length; index += 1) {
    if (value[index] === query[queryIndex]) queryIndex += 1;
  }
  return queryIndex === query.length;
}

function wholeWordMatch(value: string, query: string): boolean {
  const words = new Set(value.split(' ').filter(Boolean));
  return query
    .split(' ')
    .filter(Boolean)
    .every((word) => words.has(word));
}

function score<T extends SearchCandidate>(
  candidate: T,
  rawQuery: string,
): RankedCandidate<T> | null {
  const query = normalize(rawQuery);
  if (!query) return { candidate, tier: 0, field: 0 };
  const label = normalize(candidate.label);
  const aliases = candidate.aliases.map(normalize);
  const description = normalize(candidate.description);
  const breadcrumb = normalize(candidate.breadcrumb.join(' '));

  if (label === query) return { candidate, tier: 6, field: 4 };
  if (aliases.includes(query)) return { candidate, tier: 6, field: 3 };
  if (label.startsWith(query)) return { candidate, tier: 5, field: 4 };
  if (aliases.some((alias) => alias.startsWith(query))) {
    return { candidate, tier: 4, field: 2 };
  }
  if (wholeWordMatch(label, query)) return { candidate, tier: 3, field: 4 };
  if (aliases.some((alias) => wholeWordMatch(alias, query))) {
    return { candidate, tier: 3, field: 3 };
  }
  if (description.includes(query)) return { candidate, tier: 2, field: 2 };
  if (breadcrumb.includes(query)) return { candidate, tier: 2, field: 1 };
  const joined = [label, ...aliases, description, breadcrumb].join(' ');
  return subsequence(joined, query) ? { candidate, tier: 1, field: 0 } : null;
}

/** Rank candidates with one deterministic lexical model. */
export function rankSearchCandidates<T extends SearchCandidate>(
  candidates: readonly T[],
  query: string,
): readonly T[] {
  return candidates
    .flatMap((candidate) => {
      const ranked = score(candidate, query);
      return ranked ? [ranked] : [];
    })
    .sort((a, b) => {
      if (a.tier !== b.tier) return b.tier - a.tier;
      if (a.field !== b.field) return b.field - a.field;
      if (a.candidate.source === b.candidate.source) {
        return b.candidate.sourceRank - a.candidate.sourceRank;
      }
      return a.candidate.source === 'catalog' ? -1 : 1;
    })
    .map((ranked) => ranked.candidate);
}

/** Merge catalog and remote results under the palette's 20-row query limit. */
export function mergeSearchCandidates<T extends SearchCandidate>(
  catalog: readonly T[],
  remote: readonly T[],
  query: string,
  limit = 20,
): readonly T[] {
  return rankSearchCandidates([...catalog, ...remote], query).slice(0, limit);
}
