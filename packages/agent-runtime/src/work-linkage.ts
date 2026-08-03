/**
 * `@docket/agent-runtime` — deciding which existing objective a new piece of work belongs to.
 *
 * @remarks
 * Athena's work is only the work Docket defines, and every piece of it has to find its place in
 * the structure that already exists. Silently creating orphan tasks is the failure mode that
 * turns a plan into a pile: the work is tracked, but nobody can see what it was for.
 *
 * The decision is made here, as a pure function, for two reasons. It has to be assertable
 * against a fixture (a model asked to "link it if you can" is not testable), and it has to
 * produce an explicit *negative* — {@link ParentResolution.reason} distinguishes "there was
 * nothing to link to" from "nothing was close enough", so the agent can say which one happened
 * instead of quietly attaching the work to nothing.
 */
import { topicTerms } from './conversation-segmenter';

/** The kinds of container a task can hang from, most specific first. */
export type WorkParentKind = 'project' | 'initiative' | 'program' | 'milestone';

/** Every parent kind, ordered by how specific a home it is. */
export const WORK_PARENT_KINDS: readonly WorkParentKind[] = [
  'project',
  'milestone',
  'initiative',
  'program',
];

/** One existing container the new work could belong to. */
export interface ParentCandidate {
  /** The container's Docket id. */
  readonly id: string;
  /** What kind of container it is. */
  readonly kind: WorkParentKind;
  /** Its name. */
  readonly title: string;
  /** Its description, when it has one; weighted lower than the name. */
  readonly description?: string | null;
  /** Whether it is still open. A closed container is never chosen. */
  readonly open?: boolean;
}

/** Why a resolution came out the way it did. */
export type ParentResolutionReason = 'matched' | 'no-candidates' | 'below-threshold';

/** The decision. */
export interface ParentResolution {
  /** The chosen container, or `null` when none plausibly applies. */
  readonly parent: ParentCandidate | null;
  /** The winning score, or the best score seen when nothing was chosen. */
  readonly score: number;
  /** How many open candidates were considered. */
  readonly considered: number;
  /** Which of the three outcomes this is. */
  readonly reason: ParentResolutionReason;
  /** The request terms that drove the match, for an explanation the user can read. */
  readonly matchedTerms: readonly string[];
}

/** Options for {@link resolveWorkParent}. */
export interface ResolveWorkParentOptions {
  /** Minimum score required to attach. Below it, the work is created unlinked. */
  readonly threshold?: number;
  /** How much a description term counts relative to a title term. */
  readonly descriptionWeight?: number;
}

/**
 * The score a candidate must reach before Athena attaches work to it.
 *
 * @remarks
 * Tuned so a single shared common word cannot capture a task, while two matching distinctive
 * words can. Attaching work to the wrong objective is worse than leaving it unattached: an
 * orphan is visible and fixable in one click, a mis-parented task is invisible and misleads
 * every roll-up above it.
 */
export const DEFAULT_PARENT_THRESHOLD = 1.5;

/** Title terms carry full weight; description terms carry this fraction of it. */
export const DEFAULT_DESCRIPTION_WEIGHT = 0.4;

/**
 * Choose the existing objective a request most plausibly belongs to.
 *
 * @remarks
 * Scoring is inverse-document-frequency weighted term overlap: a term shared with only one
 * candidate is strong evidence, a term shared with all of them is none. Ties break toward the
 * more specific container (a project over the initiative above it), because that is where a
 * person would have filed it.
 *
 * @param request - What the user asked for, in their own words.
 * @param candidates - The open containers in scope.
 * @param options - Threshold and description weighting overrides.
 * @returns the decision, including an explicit negative when nothing applies.
 */
export function resolveWorkParent(
  request: string,
  candidates: readonly ParentCandidate[],
  options: ResolveWorkParentOptions = {},
): ParentResolution {
  const threshold = options.threshold ?? DEFAULT_PARENT_THRESHOLD;
  const descriptionWeight = options.descriptionWeight ?? DEFAULT_DESCRIPTION_WEIGHT;
  const open = candidates.filter((candidate) => candidate.open !== false);
  const requestTerms = new Set(topicTerms(request));
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
    title: new Set(topicTerms(candidate.title)),
    description: new Set(topicTerms(candidate.description ?? '')),
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
      /* v8 ignore next -- unreachable: `documentFrequency` was built above from every profile's
         title/description terms, and `term` is only reached here once it is known to be in this
         profile's title or description — so it is always already in the map. This only narrows
         `Map.get`'s `V | undefined` return type. */
      const df = documentFrequency.get(term) ?? 1;
      // A term every candidate shares carries a factor of exactly 1 — it is evidence that the
      // request is about *something here*, not about *this one*. Distinctiveness multiplies it.
      const distinctiveness = 1 + Math.log(open.length / df);
      score += (inTitle ? 1 : descriptionWeight) * distinctiveness;
      matched.push(term);
    }
    return { candidate: profile.candidate, score, matched };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const bySpecificity = specificity(a.candidate.kind) - specificity(b.candidate.kind);
    if (bySpecificity !== 0) return bySpecificity;
    return a.candidate.id.localeCompare(b.candidate.id);
  });

  const best = scored[0];
  /* v8 ignore next -- @preserve defensive: `open.length > 0` guarantees a best entry */
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
 * The sentence Athena says about where she filed the work.
 *
 * @remarks
 * Application-owned copy, generated from the decision rather than from a model, so the promise
 * "she states in the transcript that she could not find a parent" holds even when the model
 * says nothing about it. Silent orphaning is a product failure, not a phrasing one.
 *
 * @param resolution - The decision.
 * @param nouns - The reader's own vocabulary for each parent kind.
 * @returns one sentence.
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
