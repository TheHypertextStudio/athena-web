/**
 * `components/work-views/work-view-page-copy` — the vocabulary each roster page uses, and the
 * sibling page its view tabs lead to.
 */
import { Layers, ListChecks, Target } from '@docket/ui/icons';
import type { ViewTarget } from '@docket/work/view-contract';

import {
  PROJECT_LENS_COPY,
  PROJECT_LENS_TRANSITION,
  projectDependenciesHref,
} from './project-lens-frame';

/** The `view-transition-name` each shared element carries on a roster that has a sibling page. */
type LensTransitions = Partial<typeof PROJECT_LENS_TRANSITION>;

/** A sibling page a roster's view tabs lead to, and the shared elements that morph between them. */
interface PageLens {
  /** The sibling page's href for a workspace. */
  readonly href: (organizationId: string) => string;
  /** The transition name each shared element carries on the roster. */
  readonly transitions: typeof PROJECT_LENS_TRANSITION;
}

/** The vocabulary a roster uses for its record, and its sibling page when it has one. */
export const PAGE_COPY = {
  task: { title: 'Tasks', singular: 'task', icon: ListChecks, lens: null },
  project: {
    ...PROJECT_LENS_COPY,
    lens: { href: projectDependenciesHref, transitions: PROJECT_LENS_TRANSITION },
  },
  program: { title: 'Programs', singular: 'program', icon: Layers, lens: null },
  initiative: { title: 'Initiatives', singular: 'initiative', icon: Target, lens: null },
} as const satisfies Record<
  ViewTarget,
  {
    readonly title: string;
    readonly singular: string;
    readonly icon: unknown;
    readonly lens: PageLens | null;
  }
>;

/** A roster's sibling page as one workspace sees it. */
export interface ResolvedPageLens {
  /** Where the view tabs' Dependencies segment leads, or `null` when the roster has none. */
  readonly dependenciesHref: string | null;
  /** The transition names for the roster's shared elements; empty when it has no sibling page. */
  readonly transitions: LensTransitions;
}

const NO_TRANSITIONS: LensTransitions = {};

/**
 * Resolve a roster's sibling page for one workspace.
 *
 * @param lens - The roster's `lens` entry from {@link PAGE_COPY}.
 * @param organizationId - The workspace whose sibling page the tabs lead to.
 */
export function resolvePageLens(lens: PageLens | null, organizationId: string): ResolvedPageLens {
  if (lens === null) return { dependenciesHref: null, transitions: NO_TRANSITIONS };
  return { dependenciesHref: lens.href(organizationId), transitions: lens.transitions };
}
