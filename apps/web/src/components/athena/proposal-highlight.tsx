'use client';

/**
 * Shared hover-highlight state between a pending proposal and the page row(s) it would change.
 *
 * @remarks
 * A proposal card lives in the Athena rail or a job card; the task it would change lives in a
 * `TaskTable` on the project page — two unrelated trees. {@link ProposalHighlightProvider}, mounted
 * once by `AthenaShell`, is the one piece of shared state that lets a proposal say "this is what I
 * would touch" and a page say "then tint that row" without either owning the other.
 * `ProposalGroupCard`'s row and the job card's decision block call {@link useSetHighlightedIds} on
 * pointer enter/leave; the project page reads {@link useHighlightedIds} and passes it down to
 * `TaskTable` as `highlightedIds`.
 */
import { createContext, useContext, useState, type JSX, type ReactNode } from 'react';

/** The shared empty set, so clearing the highlight never allocates. */
export const EMPTY_HIGHLIGHTED_IDS: ReadonlySet<string> = new Set();

/** No-op setter used outside {@link ProposalHighlightProvider}, so a caller degrades quietly. */
function noopSetHighlightedIds(): void {
  // Intentionally inert: there is no provider to hold the highlight.
}

const HighlightedIdsContext = createContext<ReadonlySet<string>>(EMPTY_HIGHLIGHTED_IDS);
const SetHighlightedIdsContext =
  createContext<(ids: ReadonlySet<string>) => void>(noopSetHighlightedIds);

/** Provide the page-wide proposal hover-highlight set. Mount once, in `AthenaShell`. */
export function ProposalHighlightProvider({ children }: { children: ReactNode }): JSX.Element {
  const [ids, setIds] = useState<ReadonlySet<string>>(EMPTY_HIGHLIGHTED_IDS);
  return (
    <HighlightedIdsContext.Provider value={ids}>
      <SetHighlightedIdsContext.Provider value={setIds}>
        {children}
      </SetHighlightedIdsContext.Provider>
    </HighlightedIdsContext.Provider>
  );
}

/** The task ids the currently hovered proposal would change; empty when nothing is hovered. */
export function useHighlightedIds(): ReadonlySet<string> {
  return useContext(HighlightedIdsContext);
}

/** Set (or, with {@link EMPTY_HIGHLIGHTED_IDS}, clear) the currently hovered proposal's target ids. */
export function useSetHighlightedIds(): (ids: ReadonlySet<string>) => void {
  return useContext(SetHighlightedIdsContext);
}

/**
 * The task id(s) a proposal's raw tool input targets — `taskId` for a single-task proposal,
 * `taskIds` for a batch one.
 *
 * @param input - The proposal's raw tool input, when one is available.
 * @returns the target task ids; {@link EMPTY_HIGHLIGHTED_IDS} when the input names none.
 */
export function taskIdsFromInput(
  input: Readonly<Record<string, unknown>> | null | undefined,
): ReadonlySet<string> {
  if (!input) return EMPTY_HIGHLIGHTED_IDS;
  const ids = new Set<string>();
  const single = input['taskId'];
  if (typeof single === 'string') ids.add(single);
  const many = input['taskIds'];
  if (Array.isArray(many)) {
    for (const id of many) if (typeof id === 'string') ids.add(id);
  }
  return ids;
}
