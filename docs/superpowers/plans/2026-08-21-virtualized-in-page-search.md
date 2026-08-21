# Virtualized In-Page Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Ctrl/Cmd+F focus one consistent, complete-corpus search field on every virtualized
Docket surface while preserving native browser find elsewhere.

**Architecture:** One application provider routes the shortcut through a small target interface.
Feature controllers own query state and either a complete-resident or server-backed adapter; the
shared field owns only search-field interaction and accessibility. `ListView` and `EntityTable`
remain presentation-only and receive rows that already match.

**Tech Stack:** React 19 context and hooks, Next.js App Router, TanStack Query, TanStack Virtual,
Vitest, Testing Library, TypeScript, Playwright.

---

## File responsibilities

- Create `apps/web/src/components/in-page-search/in-page-search-provider.tsx` for shortcut routing,
  target registration, precedence, and focus restoration.
- Create `apps/web/src/components/in-page-search/in-page-search-field.tsx` for the shared search
  input, clear action, Escape behavior, shortcut label, and result-status live region.
- Create `apps/web/src/components/in-page-search/use-resident-in-page-search.ts` for deferred,
  complete-resident matching. This module never fetches data.
- Create focused tests beside the web component tests for each shared unit.
- Modify `apps/web/src/components/providers.tsx` to mount exactly one provider.
- Modify Library, Triage, My Work, and `ViewRunner` to register targets and pass complete matched
  collections into their existing virtual renderers.
- Add a repository policy test that inventories every production TanStack Virtual caller and
  requires an in-page search integration or an explicit non-search rendering-only exemption.
- Extend the Library Playwright scenario to exercise Ctrl/Cmd+F and native fallback where the
  existing browser harness permits it.

### Task 1: Shortcut provider and dependency boundary

**Files:**

- Create: `apps/web/src/components/in-page-search/in-page-search-provider.tsx`
- Create: `apps/web/tests/components/in-page-search/in-page-search-provider.test.tsx`
- Modify: `apps/web/src/components/providers.tsx`

- [ ] **Step 1: Write the provider tests before production code**

  Add tests that mount real registered targets under the provider. The tests must prove Control+F
  and Meta+F focus and select the target field, a repeat or Alt-modified event remains unclaimed,
  an empty registry leaves `defaultPrevented` false, the deepest focused target wins, a closed
  target unregisters, and a target returning `false` lets a fallback target claim the command.

  Use this test target rather than mocking provider internals:

  ```tsx
  function Target({ id, enabled = true }: { id: string; enabled?: boolean }): JSX.Element {
    const rootRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    useInPageSearchTarget({ id, rootRef, inputRef, enabled });
    return (
      <div ref={rootRef}>
        <input ref={inputRef} aria-label={`${id} search`} defaultValue={`${id} query`} />
      </div>
    );
  }
  ```

- [ ] **Step 2: Run the provider test and verify RED**

  Run:

  ```bash
  pnpm --filter @docket/web exec vitest run \
    tests/components/in-page-search/in-page-search-provider.test.tsx
  ```

  Expect failure because `InPageSearchProvider` and `useInPageSearchTarget` do not exist.

- [ ] **Step 3: Implement the target interface and provider**

  Export this public hook boundary:

  ```ts
  export interface InPageSearchTargetOptions {
    readonly id: string;
    readonly rootRef: React.RefObject<HTMLElement | null>;
    readonly inputRef: React.RefObject<HTMLInputElement | null>;
    readonly enabled?: boolean;
  }

  export interface InPageSearchTargetHandle {
    readonly restoreFocus: () => void;
  }

  export function useInPageSearchTarget(
    options: InPageSearchTargetOptions,
  ): InPageSearchTargetHandle;
  ```

  Keep registrations in a provider-owned `Map`. Store stable getters for `root` and `enabled` so a
  ref assignment or prop change does not require a document-listener reinstall. On `focusin`, mark
  only the deepest registered root containing the focused element as most recent. On the exact
  Control/Meta+F command, try the focused target, then remaining targets by focus/registration
  sequence. Call `preventDefault()` only after a field was focused successfully. Save the prior
  connected `document.activeElement`, focus the input, and select its value. `restoreFocus()` must
  focus the saved element only while it remains connected.

- [ ] **Step 4: Mount one provider in the global provider stack**

  Wrap `ServiceWorkerProvider` and application children with `InPageSearchProvider` inside
  `Providers`. Update the provider-stack TSDoc to name the new responsibility. Do not add any other
  document-level Ctrl/Cmd+F listener.

- [ ] **Step 5: Run provider and provider-stack tests and verify GREEN**

  Run:

  ```bash
  pnpm --filter @docket/web exec vitest run \
    tests/components/in-page-search/in-page-search-provider.test.tsx \
    tests/components/providers.test.tsx
  ```

  Expect both files to pass with no React warnings.

### Task 2: Shared field and complete-resident adapter

**Files:**

- Create: `apps/web/src/components/in-page-search/in-page-search-field.tsx`
- Create: `apps/web/src/components/in-page-search/use-resident-in-page-search.ts`
- Create: `apps/web/tests/components/in-page-search/in-page-search-field.test.tsx`
- Create: `apps/web/tests/components/in-page-search/use-resident-in-page-search.test.tsx`

- [ ] **Step 1: Write failing field interaction tests**

  Pin this public contract:

  ```ts
  export interface InPageSearchFieldProps {
    readonly inputRef: React.RefObject<HTMLInputElement | null>;
    readonly value: string;
    readonly onValueChange: (value: string) => void;
    readonly onEscapeEmpty: () => void;
    readonly label: string;
    readonly placeholder: string;
    readonly resultCount: number;
    readonly pending?: boolean;
    readonly className?: string;
  }
  ```

  Prove typing calls `onValueChange`, the visible clear action empties a non-empty value, Escape
  clears first, Escape on an empty value calls `onEscapeEmpty`, the live region announces the
  settled result count, and `aria-busy` represents pending work without erasing that count.

- [ ] **Step 2: Write failing complete-resident adapter tests**

  Define a generic hook that accepts an explicit completeness marker:

  ```ts
  export interface CompleteResidentCollection<T> {
    readonly completeness: 'complete';
    readonly items: readonly T[];
  }

  export function useResidentInPageSearch<T>(options: {
    readonly source: CompleteResidentCollection<T>;
    readonly searchableText: (item: T) => string;
  }): {
    readonly draft: string;
    readonly setDraft: React.Dispatch<React.SetStateAction<string>>;
    readonly settledQuery: string;
    readonly items: readonly T[];
  };
  ```

  Test case-insensitive matching, collapsed whitespace, multiple terms that may occur in any order,
  original ordering, stable identity when the query is empty, and an update to the complete source.

- [ ] **Step 3: Run both tests and verify RED**

  Run:

  ```bash
  pnpm --filter @docket/web exec vitest run \
    tests/components/in-page-search/in-page-search-field.test.tsx \
    tests/components/in-page-search/use-resident-in-page-search.test.tsx
  ```

  Expect module-not-found failures for the two production modules.

- [ ] **Step 4: Implement the field and adapter minimally**

  Use the existing MD3 `Input`, `Button`, and semantic typography tokens. Determine the shortcut
  label after mount from the user agent. Use `useDeferredValue` for resident query settlement.
  Normalize with `trim().toLocaleLowerCase().split(/\s+/)` and require every term to occur in the
  normalized searchable text. Memoize results by source items, settled terms, and extractor.

- [ ] **Step 5: Run both tests and verify GREEN**

  Run the Step 3 command again. Expect both test files to pass with no accessibility warnings.

### Task 3: Library server-search integration

**Files:**

- Modify: `apps/web/src/components/library/library-client.tsx`
- Modify: `apps/web/tests/components/library/library-client.test.tsx`
- Modify: `apps/web/e2e/work/library-finder.spec.ts`

- [ ] **Step 1: Add a failing Library shortcut test**

  Render Library under `InPageSearchProvider`. Fire Meta+F and Control+F at `document`, then assert
  that the Library search field owns focus and its current query is selected. Type a term and prove
  the existing search request still includes that term, remains cursor-backed, and retains server
  order. Clear it and prove grouped browsing and its saved scroll position return.

- [ ] **Step 2: Run the Library test and verify RED**

  Run:

  ```bash
  pnpm --filter @docket/web exec vitest run tests/components/library/library-client.test.tsx
  ```

  Expect the shortcut assertion to fail because Library is not registered.

- [ ] **Step 3: Register Library without changing its data adapter**

  Add a root ref and input ref, register them through `useInPageSearchTarget`, and replace the raw
  search input with `InPageSearchField`. Keep `useViewState`, the `q` URL transaction, the
  180-millisecond debounce, `apiInfiniteQueryOptions`, cancellation, cursor accumulation, server
  relevance, retry, and browse/search scroll restoration unchanged. Wire empty Escape to
  `restoreFocus()`.

- [ ] **Step 4: Extend the browser scenario**

  In `library-finder.spec.ts`, use the platform-appropriate modifier to focus search, enter a term,
  and verify a resource beyond the mounted DOM is found. Clear search and verify the browse group
  returns. Keep the existing 390-pixel layout assertion.

- [ ] **Step 5: Run Library tests and verify GREEN**

  Run the Step 2 command. Expect all Library component tests to pass.

### Task 4: Complete-resident ListView integrations

**Files:**

- Modify: `apps/web/src/app/(app)/orgs/[orgId]/triage/page.tsx`
- Modify: `apps/web/src/app/(app)/orgs/[orgId]/my-work/my-work-client.tsx`
- Modify: `apps/web/src/components/views/view-runner.tsx`
- Create: `apps/web/tests/components/in-page-search/virtualized-pages.test.tsx`
- Modify: `apps/web/tests/components/views/view-runner.test.tsx`

- [ ] **Step 1: Add failing integration tests**

  Test Triage and My Work with more rows than the virtualizer mounts. Ctrl/Cmd+F must focus the
  shared field, and a term matching an offscreen task must reduce the semantic grid to that task.
  Test that clearing restores original order and groups. In `ViewRunner`, test that transient search
  composes with the authored filters before grouping and does not mutate `ViewState`.

- [ ] **Step 2: Run integration tests and verify RED**

  Run:

  ```bash
  pnpm --filter @docket/web exec vitest run \
    tests/components/in-page-search/virtualized-pages.test.tsx \
    tests/components/views/view-runner.test.tsx
  ```

  Expect shortcut/search assertions to fail because these surfaces have no target or field.

- [ ] **Step 3: Integrate Triage**

  Mark the unbounded task response as a `CompleteResidentCollection`. Search task title, visible
  team label, visible assignee name, and provider label. Apply the resident result before passing
  `items` to `ListView`. Render the shared field above the scroll region, and keep Suggestions
  outside the target because it is not part of the virtualized queue.

- [ ] **Step 4: Integrate My Work**

  Search only the active tab's complete semantic collection. Include task title, visible project
  group, status label, assignee, and workspace-visible agent/session label. Switching tabs resets the
  transient query and target result count. Counts in the tab strip continue to describe the full
  tabs rather than the current search result.

- [ ] **Step 5: Integrate saved task views**

  Add transient query state inside `ViewRunner`. Search the complete `tasks` prop by title and the
  display labels available through the field catalog. Filter by the transient query before calling
  `applyView`, so authored filters, sort, and grouping remain authoritative over the matched set.
  Do not write the transient query into the saved view or URL codec.

- [ ] **Step 6: Run integration tests and verify GREEN**

  Run the Step 2 command. Expect both files to pass with no row-key or `act()` warnings.

### Task 5: Policy, accessibility, and closeout

**Files:**

- Create:
  `packages/test-utils/tests/workspace-policies/virtualized-in-page-search-policy.test.ts`
- Modify: `docs/WORKLOG.md`

- [ ] **Step 1: Write and run the failing policy test**

  The test must locate production calls to `useVirtualizer` and JSX uses of the exported virtual
  components. It must assert that `ListView` and virtualized `EntityTable` remain the only primitive
  owners, and that every product caller is in the explicit search integration registry. Resident
  entries must name the unbounded data definition that proves `completeness: 'complete'`; cursor
  entries must name their server adapter. Run the single policy test and expect failure until all
  four integrations are registered.

- [ ] **Step 2: Add the explicit integration registry and make the policy pass**

  Keep the registry inside the policy test rather than production code. Record Library as
  `server-cursor` and Triage, My Work, and saved views as `resident-complete`. The test must fail on
  any new production caller until its search adapter and completeness evidence are reviewed.

- [ ] **Step 3: Run focused behavioral and accessibility suites**

  Run:

  ```bash
  pnpm --filter @docket/web exec vitest run \
    tests/components/in-page-search \
    tests/components/library/library-client.test.tsx \
    tests/components/views/view-runner.test.tsx
  pnpm --filter @docket/test-utils exec vitest run \
    tests/workspace-policies/virtualized-in-page-search-policy.test.ts
  pnpm --filter @docket/ui exec vitest run \
    tests/components/views/entity-table-virtual.test.tsx \
    tests/components/views/list-view.test.tsx
  ```

  Expect every test to pass. Confirm the 10,000-row bound remains at no more than 100 mounted rows.

- [ ] **Step 4: Run repository gates with bounded concurrency**

  Run typecheck, lint, tests, and build serially. Use `--concurrency=1` for Turbo. Run the
  repository secret scan separately and report any existing `.env.local` failure without printing
  values. Run the Library Playwright scenario with one worker if the authentication harness reaches
  the page.

- [ ] **Step 5: Review against every acceptance criterion**

  Confirm native fallback, Mac and Windows modifiers, nested precedence, complete-corpus evidence,
  grouping restoration, active-descendant behavior, live results, server cancellation, and the DOM
  bound. Fix any gap before documenting completion.

- [ ] **Step 6: Finish the worklog and commit the implementation**

  Move `[IN-PAGE-SEARCH-001]` to completed only when the evidence above passes. Record exact test
  counts and any external browser blocker. Commit with the repository-declared `web` scope and a
  body that explains the provider/adapter boundary and complete-corpus invariant.
