/** The kinds of container a task can hang from, most specific first. */
export type WorkParentKind = 'project' | 'initiative' | 'program' | 'milestone';

/** Every parent kind, ordered by how specific a home it is. */
export const WORK_PARENT_KINDS: readonly WorkParentKind[] = [
  'project',
  'milestone',
  'initiative',
  'program',
];

/** One existing container a new task could belong to. */
export interface ParentCandidate {
  /** The container's Docket id. */
  readonly id: string;
  /** What kind of container it is. */
  readonly kind: WorkParentKind;
  /** Its name. */
  readonly title: string;
  /** Its description, when present; it carries less weight than the name. */
  readonly description?: string | null;
  /** Whether it remains open. A closed container is never chosen. */
  readonly open?: boolean;
}

/** Why a parent-resolution decision came out the way it did. */
export type ParentResolutionReason = 'matched' | 'no-candidates' | 'below-threshold';

/** The decision about where a task belongs. */
export interface ParentResolution {
  /** The chosen container, or `null` when none plausibly applies. */
  readonly parent: ParentCandidate | null;
  /** The winning score, or the best score when no candidate was selected. */
  readonly score: number;
  /** How many open candidates were considered. */
  readonly considered: number;
  /** Which of the explicit resolution outcomes occurred. */
  readonly reason: ParentResolutionReason;
  /** The request terms that drove the match, for a human-readable explanation. */
  readonly matchedTerms: readonly string[];
}

/** Options for {@link resolveWorkParent}. */
export interface ResolveWorkParentOptions {
  /** Minimum score required to attach a task. */
  readonly threshold?: number;
  /** The relative weight of a description term compared with a title term. */
  readonly descriptionWeight?: number;
}

/** A task must meet this score before Work attaches it to a parent. */
export const DEFAULT_PARENT_THRESHOLD = 1.5;

/** A matching description term carries this fraction of a title-term's weight. */
export const DEFAULT_DESCRIPTION_WEIGHT = 0.4;

/**
 * Terms that occur in nearly every plain-language request and do not identify a work topic.
 *
 * @remarks
 * Parent resolution deliberately owns its own lexical normalization instead of importing the
 * Athena conversation segmenter. A work decision must remain usable by every delivery surface,
 * including ones that do not host an Athena conversation.
 */
const WORK_PARENT_STOP_WORDS: ReadonlySet<string> = new Set([
  'a',
  'about',
  'after',
  'again',
  'all',
  'also',
  'am',
  'an',
  'and',
  'any',
  'are',
  'as',
  'at',
  'be',
  'because',
  'been',
  'before',
  'being',
  'but',
  'by',
  'can',
  'could',
  'did',
  'do',
  'does',
  'doing',
  'done',
  'for',
  'from',
  'get',
  'got',
  'had',
  'has',
  'have',
  'he',
  'her',
  'here',
  'hers',
  'him',
  'his',
  'how',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'just',
  'let',
  'like',
  'make',
  'me',
  'more',
  'most',
  'my',
  'need',
  'no',
  'not',
  'now',
  'of',
  'ok',
  'on',
  'one',
  'only',
  'or',
  'other',
  'our',
  'out',
  'over',
  'please',
  'put',
  'really',
  'said',
  'same',
  'say',
  'see',
  'she',
  'should',
  'so',
  'some',
  'still',
  'such',
  'sure',
  'take',
  'than',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'thing',
  'things',
  'this',
  'those',
  'through',
  'to',
  'too',
  'under',
  'up',
  'us',
  'use',
  'very',
  'want',
  'was',
  'we',
  'well',
  'were',
  'what',
  'when',
  'where',
  'which',
  'while',
  'who',
  'why',
  'will',
  'with',
  'would',
  'you',
  'your',
  'yours',
]);

/** Normalize a word just enough for ordinary English task phrasing to compare reliably. */
function stemWorkParentTerm(word: string): string {
  let stem = word;
  for (const suffix of [
    'ations',
    'ation',
    'ingly',
    'edly',
    'ings',
    'ing',
    'ers',
    'er',
    'ies',
    'ied',
    'es',
    'ed',
    's',
  ]) {
    if (stem.length > suffix.length + 2 && stem.endsWith(suffix)) {
      stem = stem.slice(0, -suffix.length);
      if (suffix === 'ies' || suffix === 'ied') stem += 'y';
      else if (suffix.startsWith('ing') || suffix === 'ed' || suffix === 'edly') {
        const last = stem.at(-1) ?? '';
        if (stem.length > 2 && last === stem.at(-2) && !'lszaeiou'.includes(last)) {
          stem = stem.slice(0, -1);
        }
      }
      break;
    }
  }
  return stem;
}

/** Return the topic-bearing comparison terms from work text. */
function workParentTerms(text: string): readonly string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2 && !WORK_PARENT_STOP_WORDS.has(word))
    .map(stemWorkParentTerm);
}

/**
 * Choose the existing objective a request most plausibly belongs to.
 *
 * @remarks
 * Scores inverse-document-frequency weighted term overlap. A term shared by only one parent is
 * useful evidence; one shared by every parent is not. Ties choose the more specific container,
 * because that is where a person would naturally file the task. Leaving a task unlinked is safer
 * than filing it under the wrong objective, so low-scoring matches are returned explicitly.
 *
 * @param request - What the user asked for, in their own words.
 * @param candidates - The open containers in scope.
 * @param options - Optional threshold and description-weight overrides.
 * @returns The resolution, including an explicit negative when no parent fits.
 */
export function resolveWorkParent(
  request: string,
  candidates: readonly ParentCandidate[],
  options: ResolveWorkParentOptions = {},
): ParentResolution {
  const threshold = options.threshold ?? DEFAULT_PARENT_THRESHOLD;
  const descriptionWeight = options.descriptionWeight ?? DEFAULT_DESCRIPTION_WEIGHT;
  const open = candidates.filter((candidate) => candidate.open !== false);
  const requestTerms = new Set(workParentTerms(request));
  if (open.length === 0 || requestTerms.size === 0) {
    return {
      parent: null,
      score: 0,
      considered: open.length,
      reason: 'no-candidates',
      matchedTerms: [],
    };
  }

  const profiles = open.map((candidate) => ({
    candidate,
    title: new Set(workParentTerms(candidate.title)),
    description: new Set(workParentTerms(candidate.description ?? '')),
  }));
  const documentFrequency = new Map<string, number>();
  for (const profile of profiles) {
    for (const term of new Set([...profile.title, ...profile.description])) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const specificity = (kind: WorkParentKind): number => WORK_PARENT_KINDS.indexOf(kind);
  const scored = profiles.map((profile) => {
    let score = 0;
    const matched: string[] = [];
    for (const term of requestTerms) {
      const inTitle = profile.title.has(term);
      const inDescription = profile.description.has(term);
      if (!inTitle && !inDescription) continue;
      const documentFrequencyForTerm = documentFrequency.get(term) ?? 1;
      const distinctiveness = 1 + Math.log(open.length / documentFrequencyForTerm);
      score += (inTitle ? 1 : descriptionWeight) * distinctiveness;
      matched.push(term);
    }
    return { candidate: profile.candidate, score, matched };
  });

  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    const bySpecificity = specificity(left.candidate.kind) - specificity(right.candidate.kind);
    if (bySpecificity !== 0) return bySpecificity;
    return left.candidate.id.localeCompare(right.candidate.id);
  });

  const best = scored[0];
  /* v8 ignore next -- `open.length > 0` guarantees one scored profile. */
  if (!best) {
    return {
      parent: null,
      score: 0,
      considered: open.length,
      reason: 'no-candidates',
      matchedTerms: [],
    };
  }
  if (best.score < threshold) {
    return {
      parent: null,
      score: best.score,
      considered: open.length,
      reason: 'below-threshold',
      matchedTerms: best.matched,
    };
  }
  return {
    parent: best.candidate,
    score: best.score,
    considered: open.length,
    reason: 'matched',
    matchedTerms: best.matched,
  };
}

/**
 * Build application-owned copy explaining where a task was filed.
 *
 * @param resolution - The parent-resolution decision.
 * @param nouns - The reader-facing vocabulary for each parent kind.
 * @returns One complete sentence suitable for a transcript or activity feed.
 */
export function describeParentResolution(
  resolution: ParentResolution,
  nouns: Readonly<Record<WorkParentKind, string>> = {
    project: 'project',
    initiative: 'initiative',
    program: 'program',
    milestone: 'milestone',
  },
): string {
  if (resolution.parent) {
    return `Filed under the ${nouns[resolution.parent.kind]} “${resolution.parent.title}”.`;
  }
  if (resolution.reason === 'no-candidates') {
    return 'Created without a parent — there is no open project or initiative to file it under yet.';
  }
  return 'Created without a parent — nothing open looked like a close enough match to file it under.';
}
