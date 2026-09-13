# Athena Companion Phase 0 (Context Spine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Athena panel survives navigation and knows the open page, with the context chip as the only visible change.

**Architecture:** A `PageContextProvider` in the shell holds the active workspace plus a page-published source (task, project, initiative, calendar item). `AthenaPanelProvider` reads that context instead of receiving a shell prop and stops clearing its selection and draft on route changes. A personal thread hook (query plus SSE tail against `/v1/me/athena/chat` and `/v1/me/athena/sessions/:id/stream`) lands now so Phase 1 can swap the rail body to it without touching data access. The rail's launch composer renders an `AthenaContextChip` for the attached context.

**Tech Stack:** Next.js App Router (client components), React 19, TanStack Query through `apps/web/src/lib/query.ts`, Hono RPC client `api.v1.me.athena.*`, Vitest + Testing Library (tests live under `apps/web/tests/`, never beside source), Playwright (`apps/web/e2e/`).

**Spec:** `docs/superpowers/specs/2026-09-12-athena-companion-design.md` §4.3, §5 Phase 0.

## Global Constraints

- Tests live in `apps/web/tests/**`, never colocated in `src/`.
- Never assert exact UI copy in tests (`getByText('…')`); assert roles, values, hrefs, presence.
- Every exported function, type, and component gets TSDoc: one-line summary, `@param`/`@returns` where not obvious.
- No chained or nested ternaries; use early returns or small helpers.
- No inline object types as parameter annotations or generic constraints; name an interface.
- UI copy is application-owned and plain; no "session", "job", "tool", "execute" in anything a person reads.
- Data access goes through `apiQueryOptions` / `useApiQuery` / `useLiveApiQuery` / `useApiMutation`; never `useEffect` + `fetch` in a component.
- Use `pnpm` only. Validate with root `pnpm typecheck`, `pnpm lint`, `pnpm test` (turbo), never a per-package `tsc`.
- Commits: `feat(athena): …` with a body ≥ 100 characters, a `Docs-impact: Updated - <page>` or `Docs-impact: Not needed - <reason>` trailer, and `Co-authored-by: Claude Fable 5.1 <noreply@anthropic.com>` (lowercase `a`/`b`). Stage and commit in one chain: `git restore --staged . && git add <paths> && git commit -F <file>`.
- Never push. Never merge; rebase only.
- No `// TODO`, no stubs, no skipped tests.

---

## File Structure

| File                                                                                                   | Responsibility                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/components/athena/page-context.tsx` (create)                                             | `PageContextProvider`, `usePageContext`, `usePublishPageSource`, `PageSource`, `buildPageContext`. Owns what page the person is on.                                  |
| `apps/web/src/components/athena/athena-panel-provider.tsx` (modify)                                    | Reads page context; keeps selection and draft across navigation; exposes `contextAttached`, `attachContext`, `detachContext`; rail launch composer renders the chip. |
| `apps/web/src/components/athena/athena-context-chip.tsx` (create)                                      | The "On: Fall fundraiser launch · Project" chip with detach and reattach.                                                                                            |
| `apps/web/src/lib/athena/thread-defs.ts` (create)                                                      | `personalThreadDef`, `usePersonalThread`, `sendPersonalMessage`: the one personal conversation with SSE tail.                                                        |
| `apps/web/src/lib/athena/query-defs.ts` (modify)                                                       | Export `toInvocationContext` (today's private `apiContext`).                                                                                                         |
| `apps/web/src/lib/query-keys.ts` (modify)                                                              | Add `athenaChat`.                                                                                                                                                    |
| `apps/web/src/components/app-shell-frame.tsx` (modify)                                                 | Mount `PageContextProvider`; stop passing `context` and `locationKey` to Athena.                                                                                     |
| `apps/web/src/app/(app)/orgs/[orgId]/tasks/[taskId]/task-detail-client.tsx` (modify)                   | Publish `task` source.                                                                                                                                               |
| `apps/web/src/app/(app)/orgs/[orgId]/projects/[projectId]/project-detail-client.tsx` (modify)          | Publish `project` source.                                                                                                                                            |
| `apps/web/src/app/(app)/orgs/[orgId]/initiatives/[initiativeId]/initiative-detail-client.tsx` (modify) | Publish `initiative` source.                                                                                                                                         |
| `apps/web/src/components/calendar/item-drawer/calendar-item-workspace.tsx` (modify)                    | Publish `calendar_item` source while open.                                                                                                                           |
| `apps/web/tests/athena/page-context.test.tsx` (create)                                                 | Provider and hook behaviour.                                                                                                                                         |
| `apps/web/tests/athena/panel-provider.test.tsx` (modify)                                               | Persistence across page changes; page context flows into new work; chip detach.                                                                                      |
| `apps/web/tests/athena/athena-context-chip.test.tsx` (create)                                          | Chip states.                                                                                                                                                         |
| `apps/web/tests/athena/thread-defs.test.tsx` (create)                                                  | Personal thread read, send, and stream merge.                                                                                                                        |
| `apps/web/e2e/athena/companion-context.spec.ts` (create)                                               | The panel keeps its selection across client navigation.                                                                                                              |
| `docs/WORKLOG.md` (modify)                                                                             | Phase 0 subtasks checked, validation recorded.                                                                                                                       |

---

### Task 1: Page context provider

**Files:**

- Create: `apps/web/src/components/athena/page-context.tsx`
- Test: `apps/web/tests/athena/page-context.test.tsx`

**Interfaces:**

- Consumes: `PersonalAthenaContext`, `PersonalAthenaSource` from `@/lib/athena/presentation` (existing).
- Produces:
  - `interface PageWorkspace { readonly workspaceId: string; readonly workspaceName?: string | undefined }`
  - `function PageContextProvider(props: { workspace: PageWorkspace | null; children: ReactNode }): JSX.Element`
  - `function usePageContext(): PersonalAthenaContext | null`
  - `function usePublishPageSource(source: PersonalAthenaSource | null): void`
  - `function PageSource(props: PersonalAthenaSource): null`
  - `function buildPageContext(workspace: PageWorkspace | null, source: PersonalAthenaSource | null): PersonalAthenaContext | null`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/tests/athena/page-context.test.tsx
import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  PageContextProvider,
  PageSource,
  buildPageContext,
  usePageContext,
} from '../../src/components/athena/page-context';

function Readout(): JSX.Element {
  const context = usePageContext();
  return <output data-testid="page-context">{JSON.stringify(context)}</output>;
}

function readContext(): unknown {
  return JSON.parse(screen.getByTestId('page-context').textContent ?? 'null');
}

afterEach(cleanup);

describe('buildPageContext', () => {
  it('returns null with neither a workspace nor a source', () => {
    expect(buildPageContext(null, null)).toBeNull();
  });

  it('omits an absent workspace name instead of writing undefined', () => {
    expect(buildPageContext({ workspaceId: 'ws_1' }, null)).toEqual({ workspaceId: 'ws_1' });
  });
});

describe('PageContextProvider', () => {
  it('reports null outside any workspace or page', () => {
    render(
      <PageContextProvider workspace={null}>
        <Readout />
      </PageContextProvider>,
    );
    expect(readContext()).toBeNull();
  });

  it('merges the shell workspace with a published page source', () => {
    render(
      <PageContextProvider workspace={{ workspaceId: 'ws_1', workspaceName: 'Harbor Health' }}>
        <PageSource type="project" id="project_1" label="Fall fundraiser launch" />
        <Readout />
      </PageContextProvider>,
    );
    expect(readContext()).toEqual({
      workspaceId: 'ws_1',
      workspaceName: 'Harbor Health',
      source: { type: 'project', id: 'project_1', label: 'Fall fundraiser launch' },
    });
  });

  it('clears the source when the page unmounts', () => {
    const view = render(
      <PageContextProvider workspace={{ workspaceId: 'ws_1' }}>
        <PageSource type="task" id="task_1" label="Confirm venue contract" />
        <Readout />
      </PageContextProvider>,
    );
    view.rerender(
      <PageContextProvider workspace={{ workspaceId: 'ws_1' }}>
        <Readout />
      </PageContextProvider>,
    );
    expect(readContext()).toEqual({ workspaceId: 'ws_1' });
  });

  it('lets a page publish without a provider', () => {
    expect(() => render(<PageSource type="task" id="task_1" />)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @docket/web exec vitest run tests/athena/page-context.test.tsx`
Expected: FAIL, the module `../../src/components/athena/page-context` cannot be resolved.

- [ ] **Step 3: Write the implementation**

```tsx
// apps/web/src/components/athena/page-context.tsx
'use client';

/**
 * What page the person is on, for Athena.
 *
 * The shell publishes the active workspace. A detail route or drawer publishes the object it
 * shows as a source. Athena reads the merged result as the default context for anything the
 * person asks, and shows it as a chip they can detach.
 */
import {
  createContext,
  type JSX,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import type { PersonalAthenaContext, PersonalAthenaSource } from '@/lib/athena/presentation';

/** The workspace the shell has resolved for the current route. */
export interface PageWorkspace {
  readonly workspaceId: string;
  readonly workspaceName?: string | undefined;
}

interface PageContextValue {
  readonly context: PersonalAthenaContext | null;
  readonly setSource: (source: PersonalAthenaSource | null) => void;
}

const PageContextContext = createContext<PageContextValue | null>(null);

/** Merge the shell workspace and a page source into one Athena context. */
export function buildPageContext(
  workspace: PageWorkspace | null,
  source: PersonalAthenaSource | null,
): PersonalAthenaContext | null {
  if (!workspace && !source) return null;
  return {
    ...(workspace ? { workspaceId: workspace.workspaceId } : {}),
    ...(workspace?.workspaceName ? { workspaceName: workspace.workspaceName } : {}),
    ...(source ? { source } : {}),
  };
}

/** Props for {@link PageContextProvider}. */
export interface PageContextProviderProps {
  readonly workspace: PageWorkspace | null;
  readonly children: ReactNode;
}

/** Hold the page context for everything under the shell. */
export function PageContextProvider({
  workspace,
  children,
}: PageContextProviderProps): JSX.Element {
  const [source, setSource] = useState<PersonalAthenaSource | null>(null);
  const workspaceId = workspace?.workspaceId;
  const workspaceName = workspace?.workspaceName;
  const context = useMemo(
    () =>
      buildPageContext(
        workspaceId ? { workspaceId, ...(workspaceName ? { workspaceName } : {}) } : null,
        source,
      ),
    [source, workspaceId, workspaceName],
  );
  const value = useMemo<PageContextValue>(() => ({ context, setSource }), [context]);
  return <PageContextContext.Provider value={value}>{children}</PageContextContext.Provider>;
}

/** The merged page context, or null outside a workspace and page. */
export function usePageContext(): PersonalAthenaContext | null {
  return useContext(PageContextContext)?.context ?? null;
}

/**
 * Publish the object this page shows as Athena's source while the page is mounted.
 *
 * @param source - The object on screen; null publishes nothing.
 */
export function usePublishPageSource(source: PersonalAthenaSource | null): void {
  const setSource = useContext(PageContextContext)?.setSource;
  const type = source?.type;
  const id = source?.id;
  const label = source?.label;
  useEffect(() => {
    if (!setSource || !type || !id) return;
    setSource({ type, id, ...(label ? { label } : {}) });
    return () => {
      setSource(null);
    };
  }, [id, label, setSource, type]);
}

/** Publish a page source from JSX. Renders nothing. */
export function PageSource(source: PersonalAthenaSource): null {
  usePublishPageSource(source);
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @docket/web exec vitest run tests/athena/page-context.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

Write `/tmp/msg-task1.txt`:

```
feat(athena): Know which page the person is on

Add a page context provider that merges the shell's active workspace with the object a detail
route or drawer publishes. Athena reads the merged context as the default for anything the
person asks, which is the first half of the companion design's "already knows" property. Nothing
consumes it yet; the panel provider switches to it in the next commit.

Docs-impact: Not needed - internal provider with no user-facing change yet
Co-authored-by: Claude Fable 5.1 <noreply@anthropic.com>
```

Run:

```bash
git restore --staged . && git add apps/web/src/components/athena/page-context.tsx apps/web/tests/athena/page-context.test.tsx && git commit -F /tmp/msg-task1.txt
```

---

### Task 2: The panel survives navigation and reads the page

**Files:**

- Modify: `apps/web/src/components/athena/athena-panel-provider.tsx`
- Modify: `apps/web/src/components/app-shell-frame.tsx` (the `AthenaShell` component, lines 894–968)
- Test: `apps/web/tests/athena/panel-provider.test.tsx`

**Interfaces:**

- Consumes: `PageContextProvider`, `usePageContext`, `PageWorkspace`, `PageSource` from Task 1.
- Produces: `AthenaPanelProviderProps` loses `context` and `locationKey`. `AthenaShellProps.context` becomes `workspace: PageWorkspace | null` and `AthenaShellProps.locationKey` is removed.

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/tests/athena/panel-provider.test.tsx`. Extend the imports and the launcher:

```tsx
import { PageContextProvider, PageSource } from '../../src/components/athena/page-context';
```

Replace `AthenaLaunchers` with:

```tsx
function AthenaLaunchers(): ReactNode {
  const { openAthena, railStatus } = useAthenaPanel();
  return (
    <>
      <span data-testid="athena-rail-status">{railStatus?.tone ?? 'none'}</span>
      <button
        type="button"
        onClick={() => {
          openAthena({
            workspaceId: 'workspace_1',
            source: { type: 'project', id: 'project_1', label: 'Athena launch' },
          });
        }}
      >
        Open contextual Athena
      </button>
      <button
        type="button"
        onClick={() => {
          openAthena();
        }}
      >
        Open ambient Athena
      </button>
    </>
  );
}
```

Append two tests inside `describe('AthenaPanelProvider', …)`:

```tsx
it('keeps the selected session when the page underneath changes', async () => {
  const api = transport();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (source: ReactNode): ReactNode => (
    <QueryClientProvider client={client}>
      <PageContextProvider
        workspace={{ workspaceId: 'workspace_1', workspaceName: 'Hypertext Studio' }}
      >
        {source}
        <AthenaPanelProvider transport={api} railVisible onRevealRail={vi.fn()}>
          <AthenaRailPanel />
        </AthenaPanelProvider>
      </PageContextProvider>
    </QueryClientProvider>
  );
  const view = render(tree(<PageSource type="task" id="task_1" label="Confirm venue contract" />));

  fireEvent.click(
    await screen.findByRole('button', { name: /Confirm the private launch review change/ }),
  );
  expect(await screen.findByRole('button', { name: 'Back' })).toBeVisible();

  view.rerender(tree(<PageSource type="project" id="project_1" label="Fall fundraiser launch" />));

  expect(
    await screen.findByRole('heading', { name: 'Confirm the private launch review change' }),
  ).toBeVisible();
});

it('starts new work with the open page as its context', async () => {
  const api = transport();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PageContextProvider
        workspace={{ workspaceId: 'workspace_1', workspaceName: 'Hypertext Studio' }}
      >
        <PageSource type="project" id="project_1" label="Fall fundraiser launch" />
        <AthenaPanelProvider transport={api} railVisible onRevealRail={vi.fn()}>
          <AthenaLaunchers />
          <AthenaRailPanel />
        </AthenaPanelProvider>
      </PageContextProvider>
    </QueryClientProvider>,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Open ambient Athena' }));
  fireEvent.change(await screen.findByLabelText('Athena objective'), {
    target: { value: 'What is at risk here?' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Start work' }));

  await waitFor(() => {
    expect(api.create).toHaveBeenCalledWith({
      prompt: 'What is at risk here?',
      context: {
        workspaceId: 'workspace_1',
        workspaceName: 'Hypertext Studio',
        source: { type: 'project', id: 'project_1', label: 'Fall fundraiser launch' },
      },
    });
  });
});
```

Also update the existing test `keeps the selected session when the shell rerenders the same workspace context`: replace the two `context={{ workspaceId: 'workspace_1', workspaceName: 'Hypertext Studio' }}` props by wrapping each render in `<PageContextProvider workspace={{ workspaceId: 'workspace_1', workspaceName: 'Hypertext Studio' }}>…</PageContextProvider>`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @docket/web exec vitest run tests/athena/panel-provider.test.tsx`
Expected: FAIL. "Open ambient Athena" does not open a composer with a source (the second new test's `create` call has no `source`), and the first new test fails because the current provider resets selection whenever `shellContext` identity changes.

- [ ] **Step 3: Change the provider**

In `apps/web/src/components/athena/athena-panel-provider.tsx`:

Add the import:

```ts
import { usePageContext } from './page-context';
```

Replace the props interface's `context` and `locationKey` entries. The interface becomes:

```ts
/** Props for the shared Athena session state. */
export interface AthenaPanelProviderProps {
  readonly children: ReactNode;
  readonly transport?: PersonalAthenaTransport | undefined;
  /** Ask the owning shell to select and expand Athena's utility-rail panel. */
  readonly onRevealRail?: (() => void) | undefined;
  /** Whether the shell is currently displaying Athena's rail panel. */
  readonly railVisible?: boolean | undefined;
  /** Open the full Athena workspace when this route deliberately has no utility rail. */
  readonly onOpenFullAthena?:
    ((context: PersonalAthenaContext | null, draft: string | undefined) => void) | undefined;
}
```

Update the docblock above the component to:

```ts
/**
 * Keep Athena's personal session state available to contextual entry points.
 *
 * The provider owns no viewport-level chrome. The shared shell owns where the compact panel opens,
 * and the full `/athena` route remains the place for broad operations work. Selection and any
 * draft survive navigation; only the page context underneath them changes.
 */
```

Replace the function signature and the first block of state:

```ts
export function AthenaPanelProvider({
  children,
  transport = personalAthenaTransport,
  onRevealRail,
  railVisible = false,
  onOpenFullAthena,
}: AthenaPanelProviderProps): JSX.Element {
  const queryClient = useQueryClient();
  const pageContext = usePageContext();
  const [context, setContext] = useState<PersonalAthenaContext | null>(pageContext);
  const [selectedId, setSelectedId] = useState('');
  const [launchDraft, setLaunchDraft] = useState<string | null>(null);
  const pulse = useLiveApiQuery(personalAthenaPulseDef(transport), 5_000);
  const queue = useLiveApiQuery(personalAthenaQueueDef(transport, railVisible), 5_000);

  // The page moves under the panel; the panel keeps what the person was doing. Only an idle
  // panel (no selection, no draft) follows the page.
  useEffect(() => {
    if (selectedId || launchDraft !== null) return;
    setContext(pageContext);
  }, [launchDraft, pageContext, selectedId]);
```

Delete the `shellWorkspaceId`, `shellWorkspaceName`, `shellContext` declarations and the effect keyed on `[locationKey, shellContext]`.

Replace `openAthena` with this version. A call with no argument (the ⌘J shortcut and ambient
entry points) opens the launch composer when the page has a source, and otherwise opens the panel
on the page's workspace as before:

```ts
const openAthena = useCallback(
  (nextContext?: PersonalAthenaContext | null, draft?: string) => {
    const effective = nextContext === undefined && pageContext?.source ? pageContext : nextContext;
    const startsNewWork = effective !== undefined;
    const resolvedContext = effective === undefined ? pageContext : effective;
    setContext(resolvedContext);
    setSelectedId('');
    setLaunchDraft(startsNewWork ? (draft?.trim() ?? '') : null);
    reveal(resolvedContext, startsNewWork ? draft : undefined);
  },
  [pageContext, reveal],
);
```

The keyboard shortcut effect is unchanged; it already calls `openAthena()` and depends on
`[openAthena]`.

Scope note: the spec's "selection as a source with a count" for list routes waits for Phase 2,
when the shared entity table's selection model exists. `PersonalAthenaSource` has no `selection`
member today and this phase does not add one.

- [ ] **Step 4: Wire the shell**

In `apps/web/src/components/app-shell-frame.tsx`:

Add the import:

```ts
import { PageContextProvider, type PageWorkspace } from '@/components/athena/page-context';
```

In `AthenaShellProps` (line ~894) replace

```ts
  readonly locationKey: string;
```

and

```ts
  readonly context: PersonalAthenaContext | null;
```

with a single

```ts
  readonly workspace: PageWorkspace | null;
```

In `AthenaShell`'s destructuring replace `context, locationKey,` with `workspace,`. Wrap the returned tree:

```tsx
return (
  <PageContextProvider workspace={workspace}>
    <AthenaPanelProvider
      railVisible={athenaRailVisible}
      onRevealRail={
        calendarSurface || settingsSurface
          ? undefined
          : () => {
              revealRailPanel('athena');
            }
      }
      onOpenFullAthena={openFullAthena}
    >
      <AthenaShellChrome
        {...props}
        settingsSurface={settingsSurface}
        calendarSurface={calendarSurface}
        railRequest={railRequest}
        onAthenaRailVisibilityChange={setAthenaRailVisible}
      />
      <CommandPaletteHost
        panelsAvailable={!settingsSurface && !calendarSurface}
        onOpenPanel={revealRailPanel}
        sessionOwnerUserId={sessionOwnerUserId}
      />
    </AthenaPanelProvider>
  </PageContextProvider>
);
```

In `AthenaShellChromeProps` change the `Omit<…, 'context' | 'locationKey' | 'sessionOwnerUserId'>` to `Omit<AthenaShellProps, 'workspace' | 'sessionOwnerUserId'>`.

At the call site (line ~874) delete `locationKey={locationKey}` and replace the `context={…}` prop with:

```tsx
          workspace={
            resolvedOrgId
              ? { workspaceId: resolvedOrgId, workspaceName: activeWorkspaceName }
              : null
          }
```

Keep `locationKey` on `AppShellInner`; other consumers in that component still use it. If `PersonalAthenaContext` is now unused in this file, remove its import.

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm --filter @docket/web exec vitest run tests/athena/panel-provider.test.tsx tests/components/app-shell-frame.test.tsx`
Expected: PASS.

Run: `pnpm typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

Write `/tmp/msg-task2.txt`:

```
feat(athena): Keep the Athena panel open across navigation

The panel no longer clears its selected work or draft when the route changes. It reads the
page context published by the shell instead of a workspace prop, so opening Athena from any page
starts with that page attached, and an idle panel follows the page while a busy one stays put.
This is the "stays put" and "already knows" pair from the companion design.

Docs-impact: Not needed - behaviour covered by the companion design spec, no doc page changes
Co-authored-by: Claude Fable 5.1 <noreply@anthropic.com>
```

Run:

```bash
git restore --staged . && git add apps/web/src/components/athena/athena-panel-provider.tsx apps/web/src/components/app-shell-frame.tsx apps/web/tests/athena/panel-provider.test.tsx && git commit -F /tmp/msg-task2.txt
```

---

### Task 3: Detail routes and the calendar drawer publish their source

**Files:**

- Modify: `apps/web/src/app/(app)/orgs/[orgId]/tasks/[taskId]/task-detail-client.tsx` (near line 105)
- Modify: `apps/web/src/app/(app)/orgs/[orgId]/projects/[projectId]/project-detail-client.tsx` (near line 389)
- Modify: `apps/web/src/app/(app)/orgs/[orgId]/initiatives/[initiativeId]/initiative-detail-client.tsx` (near line 217)
- Modify: `apps/web/src/components/calendar/item-drawer/calendar-item-workspace.tsx` (near line 67)

**Interfaces:**

- Consumes: `usePublishPageSource` from Task 1.
- Produces: nothing new. Each route publishes `{ type, id, label }` while mounted.

- [ ] **Step 1: Task detail**

Add the import:

```ts
import { usePublishPageSource } from '@/components/athena/page-context';
```

Directly after `useDocumentTitle(task?.title);` (line 106) add:

```ts
usePublishPageSource({ type: 'task', id: taskId, ...(task?.title ? { label: task.title } : {}) });
```

- [ ] **Step 2: Project detail**

Add the same import. Directly after `useDocumentTitle(project?.name ?? navigationSnapshot?.name);` (line 390) add:

```ts
const projectLabel = project?.name ?? navigationSnapshot?.name;
usePublishPageSource({
  type: 'project',
  id: projectId,
  ...(projectLabel ? { label: projectLabel } : {}),
});
```

- [ ] **Step 3: Initiative detail**

Add the same import. Directly after the `useRegisterTabTitle('initiative', …)` line (217) add:

```ts
const initiativeLabel = detail?.name ?? navigationSnapshot?.name;
usePublishPageSource({
  type: 'initiative',
  id: initiativeId,
  ...(initiativeLabel ? { label: initiativeLabel } : {}),
});
```

- [ ] **Step 4: Calendar drawer**

Add the same import. Directly after `const { openAthena } = useAthenaPanel();` (line 67) add:

```ts
usePublishPageSource({ type: 'calendar_item', id: item.id, label: item.title });
```

Leave the existing "Have Athena handle this" button unchanged; it still passes an explicit context.

- [ ] **Step 5: Verify**

Run: `pnpm typecheck && pnpm --filter @docket/web exec vitest run tests/components tests/athena tests/calendar`
Expected: exit 0, all green. The hook is a no-op in tests that render these clients without a provider.

- [ ] **Step 6: Commit**

Write `/tmp/msg-task3.txt`:

```
feat(athena): Tell Athena which task, project, or event is open

Task, project, and initiative detail pages and the calendar item drawer publish the object they
show as Athena's page source while they are mounted. Opening Athena from any of them starts with
that object attached, without a menu item or a form, which is what the companion design means by
context arriving on its own.

Docs-impact: Not needed - no user-facing surface changes; behaviour lands with the chip
Co-authored-by: Claude Fable 5.1 <noreply@anthropic.com>
```

Run:

```bash
git restore --staged . && git add "apps/web/src/app/(app)/orgs/[orgId]/tasks/[taskId]/task-detail-client.tsx" "apps/web/src/app/(app)/orgs/[orgId]/projects/[projectId]/project-detail-client.tsx" "apps/web/src/app/(app)/orgs/[orgId]/initiatives/[initiativeId]/initiative-detail-client.tsx" apps/web/src/components/calendar/item-drawer/calendar-item-workspace.tsx && git commit -F /tmp/msg-task3.txt
```

---

### Task 4: The context chip

**Files:**

- Create: `apps/web/src/components/athena/athena-context-chip.tsx`
- Test: `apps/web/tests/athena/athena-context-chip.test.tsx`

**Interfaces:**

- Consumes: `Chip` from `@docket/ui/primitives` (`variant="input"` with `onRemove` / `removeLabel`; `variant="assist"` with `onClick`), `Sparkles` from `@docket/ui/icons`, `PersonalAthenaContext`.
- Produces:
  - `interface AthenaContextChipProps { readonly context: PersonalAthenaContext | null; readonly attached: boolean; readonly onDetach: () => void; readonly onAttach: () => void }`
  - `function AthenaContextChip(props: AthenaContextChipProps): JSX.Element | null`
  - `function contextChipLabel(context: PersonalAthenaContext): string | null`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/tests/athena/athena-context-chip.test.tsx
import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AthenaContextChip,
  contextChipLabel,
} from '../../src/components/athena/athena-context-chip';

afterEach(cleanup);

const projectContext = {
  workspaceId: 'ws_1',
  workspaceName: 'Harbor Health',
  source: { type: 'project' as const, id: 'project_1', label: 'Fall fundraiser launch' },
};

describe('contextChipLabel', () => {
  it('names the source when it has a label', () => {
    expect(contextChipLabel(projectContext)).toBe('Fall fundraiser launch');
  });

  it('falls back to the workspace name', () => {
    expect(contextChipLabel({ workspaceId: 'ws_1', workspaceName: 'Harbor Health' })).toBe(
      'Harbor Health',
    );
  });

  it('returns null with nothing to show', () => {
    expect(contextChipLabel({ workspaceId: 'ws_1' })).toBeNull();
  });
});

describe('AthenaContextChip', () => {
  it('renders nothing without a context', () => {
    const { container } = render(
      <AthenaContextChip context={null} attached onDetach={vi.fn()} onAttach={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('offers to detach an attached page', () => {
    const onDetach = vi.fn();
    render(
      <AthenaContextChip
        context={projectContext}
        attached
        onDetach={onDetach}
        onAttach={vi.fn()}
      />,
    );
    const chip = screen.getByRole('group', { name: /Fall fundraiser launch/ });
    expect(chip).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Detach/ }));
    expect(onDetach).toHaveBeenCalledTimes(1);
  });

  it('offers to reattach a detached page', () => {
    const onAttach = vi.fn();
    render(
      <AthenaContextChip
        context={projectContext}
        attached={false}
        onDetach={vi.fn()}
        onAttach={onAttach}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Fall fundraiser launch/ }));
    expect(onAttach).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @docket/web exec vitest run tests/athena/athena-context-chip.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```tsx
// apps/web/src/components/athena/athena-context-chip.tsx
'use client';

/**
 * The chip above an Athena composer that shows which page is attached to the next message.
 *
 * Attached: "On: Fall fundraiser launch · Project" with a remove control. Detached: an assist
 * chip that reattaches the page. No context, nothing rendered.
 */
import { Sparkles } from '@docket/ui/icons';
import { Chip } from '@docket/ui/primitives';
import type { JSX } from 'react';

import type { PersonalAthenaContext, PersonalAthenaSource } from '@/lib/athena/presentation';

/** Plain names for each source kind. */
const KIND_LABEL: Readonly<Record<PersonalAthenaSource['type'], string>> = {
  task: 'Task',
  project: 'Project',
  initiative: 'Initiative',
  program: 'Program',
  calendar_item: 'Calendar',
  stream_event: 'Inbox item',
};

/** The name the chip shows for a context, or null when it has nothing nameable. */
export function contextChipLabel(context: PersonalAthenaContext): string | null {
  return context.source?.label ?? context.workspaceName ?? null;
}

/** Props for {@link AthenaContextChip}. */
export interface AthenaContextChipProps {
  readonly context: PersonalAthenaContext | null;
  readonly attached: boolean;
  readonly onDetach: () => void;
  readonly onAttach: () => void;
}

/** Show the attached page and let the person detach or reattach it. */
export function AthenaContextChip({
  context,
  attached,
  onDetach,
  onAttach,
}: AthenaContextChipProps): JSX.Element | null {
  if (!context) return null;
  const label = contextChipLabel(context);
  if (!label) return null;
  const kind = context.source ? KIND_LABEL[context.source.type] : 'Workspace';

  if (!attached) {
    return (
      <Chip variant="assist" icon={<Sparkles aria-hidden="true" />} onClick={onAttach}>
        Attach {label}
      </Chip>
    );
  }
  return (
    <div role="group" aria-label={`On ${label}, ${kind}`} className="flex min-w-0">
      <Chip
        variant="input"
        icon={<Sparkles aria-hidden="true" />}
        onRemove={onDetach}
        removeLabel={`Detach ${label}`}
      >
        <span className="truncate">On: {label}</span>
        <span className="text-on-surface-variant shrink-0"> · {kind}</span>
      </Chip>
    </div>
  );
}
```

If `Chip` refuses `onClick` on `variant="assist"` at typecheck, wrap it: `<Chip variant="assist" icon={…} asChild><button type="button" onClick={onAttach}>Attach {label}</button></Chip>`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @docket/web exec vitest run tests/athena/athena-context-chip.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

Write `/tmp/msg-task4.txt`:

```
feat(athena): Show which page Athena is looking at

Add the context chip that sits above an Athena composer: "On: Fall fundraiser launch · Project"
with a detach control, and a reattach chip once detached. It is a pure presentation component
built on the shared Chip primitive; the rail composer adopts it in the next commit.

Docs-impact: Not needed - component only; the surface change is documented with its host
Co-authored-by: Claude Fable 5.1 <noreply@anthropic.com>
```

Run:

```bash
git restore --staged . && git add apps/web/src/components/athena/athena-context-chip.tsx apps/web/tests/athena/athena-context-chip.test.tsx && git commit -F /tmp/msg-task4.txt
```

---

### Task 5: The rail composer carries the chip

**Files:**

- Modify: `apps/web/src/components/athena/athena-panel-provider.tsx` (`AthenaPanelValue`, provider `value`, `AthenaRailComposer`)
- Test: `apps/web/tests/athena/panel-provider.test.tsx`

**Interfaces:**

- Consumes: `AthenaContextChip` from Task 4.
- Produces on `AthenaPanelValue`: `readonly contextAttached: boolean; readonly attachContext: () => void; readonly detachContext: () => void`.

- [ ] **Step 1: Write the failing test**

Append to `describe('AthenaPanelProvider', …)`:

```tsx
it('starts work without the page once the chip is detached', async () => {
  const api = transport();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PageContextProvider
        workspace={{ workspaceId: 'workspace_1', workspaceName: 'Hypertext Studio' }}
      >
        <PageSource type="project" id="project_1" label="Fall fundraiser launch" />
        <AthenaPanelProvider transport={api} railVisible onRevealRail={vi.fn()}>
          <AthenaLaunchers />
          <AthenaRailPanel />
        </AthenaPanelProvider>
      </PageContextProvider>
    </QueryClientProvider>,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Open ambient Athena' }));
  const form = await screen.findByRole('form', { name: 'Start Athena work' });
  expect(within(form).getByRole('group', { name: /Fall fundraiser launch/ })).toBeVisible();

  fireEvent.click(within(form).getByRole('button', { name: /Detach/ }));
  expect(within(form).queryByRole('group', { name: /Fall fundraiser launch/ })).toBeNull();

  fireEvent.change(screen.getByLabelText('Athena objective'), {
    target: { value: 'Plan my afternoon' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Start work' }));

  await waitFor(() => {
    expect(api.create).toHaveBeenCalledWith({ prompt: 'Plan my afternoon' });
  });
});
```

Add `within` to the Testing Library import.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @docket/web exec vitest run tests/athena/panel-provider.test.tsx`
Expected: FAIL, no element with role `group` in the form.

- [ ] **Step 3: Implement**

In `athena-panel-provider.tsx`:

Add the import:

```ts
import { AthenaContextChip } from './athena-context-chip';
```

Extend `AthenaPanelValue` after `railStatus`:

```ts
  /** Whether the next piece of work carries the current context. */
  readonly contextAttached: boolean;
  readonly attachContext: () => void;
  readonly detachContext: () => void;
```

Add state beside `launchDraft`:

```ts
const [contextAttached, setContextAttached] = useState(true);
```

In `openAthena`, after `setSelectedId('')` add `setContextAttached(true);`. In `closeAthena` add `setContextAttached(true);`.

In the `value` memo add:

```ts
      contextAttached,
      attachContext: () => {
        setContextAttached(true);
      },
      detachContext: () => {
        setContextAttached(false);
      },
```

and change `create` to:

```ts
      create: (prompt) => {
        actions.create({ prompt, ...(context && contextAttached ? { context } : {}) });
      },
```

Add `contextAttached` to the memo's dependency array.

In `AthenaRailComposer`, between the heading block and `MentionTextarea`, add:

```tsx
<AthenaContextChip
  context={athena.context}
  attached={athena.contextAttached}
  onDetach={athena.detachContext}
  onAttach={athena.attachContext}
/>
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @docket/web exec vitest run tests/athena`
Expected: PASS.

- [ ] **Step 5: Commit**

Write `/tmp/msg-task5.txt`:

```
feat(athena): Let a person see and drop the page attached to new Athena work

The rail's composer shows the attached page as a chip above the text. Removing it sends the
request without any page, and the chip can be put back before sending. This is the first
visible piece of the companion design: context is stated on screen, never assumed in silence.

Docs-impact: Updated - docs/superpowers/specs/2026-09-12-athena-companion-design.md
Co-authored-by: Claude Fable 5.1 <noreply@anthropic.com>
```

Run:

```bash
git restore --staged . && git add apps/web/src/components/athena/athena-panel-provider.tsx apps/web/tests/athena/panel-provider.test.tsx && git commit -F /tmp/msg-task5.txt
```

---

### Task 6: The personal thread hook

**Files:**

- Create: `apps/web/src/lib/athena/thread-defs.ts`
- Modify: `apps/web/src/lib/athena/query-defs.ts` (export the context mapper)
- Modify: `apps/web/src/lib/query-keys.ts` (line ~264)
- Test: `apps/web/tests/athena/thread-defs.test.tsx`

**Interfaces:**

- Consumes: `api.v1.me.athena.chat.$get({ query: {} })`, `api.v1.me.athena.chat.messages.$post({ json })`, `AthenaSessionDetailOut` and `SessionActivityOut` from `@docket/athena/agent-contract`, `apiQueryOptions`, `STALE`, `queryKeys`, `useLiveApiQuery`, `readProblemError`.
- Produces:
  - `queryKeys.athenaChat(): readonly ['me', 'athena', 'chat']`
  - `toInvocationContext(context?: PersonalAthenaContext): AthenaInvocationContext | undefined` (exported from `query-defs.ts`)
  - `personalThreadDef()`
  - `usePersonalThread(): UseQueryResult<AthenaSessionDetailOut>`
  - `sendPersonalMessage(body: string, context?: PersonalAthenaContext): Promise<AthenaSessionDetailOut>`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/tests/athena/thread-defs.test.tsx
import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { okResponse } from '../support/query';

const { chatGet, messagePost } = vi.hoisted(() => ({ chatGet: vi.fn(), messagePost: vi.fn() }));

vi.mock('../../src/lib/api', () => ({
  api: { v1: { me: { athena: { chat: { $get: chatGet, messages: { $post: messagePost } } } } } },
}));

import { sendPersonalMessage, usePersonalThread } from '../../src/lib/athena/thread-defs';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, (event: MessageEvent) => void>();
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(name: string, listener: (event: MessageEvent) => void): void {
    this.listeners.set(name, listener);
  }
  close(): void {}
}

function thread(status: string, activities: readonly Record<string, unknown>[] = []) {
  return {
    id: 'chat_1',
    kind: 'chat',
    status,
    objective: 'Chat',
    startedAt: '2026-09-13T10:00:00.000Z',
    endedAt: null,
    createdAt: '2026-09-13T10:00:00.000Z',
    activities,
    result: null,
  };
}

function Readout(): JSX.Element {
  const query = usePersonalThread();
  return <output data-testid="count">{query.data?.activities.length ?? 'none'}</output>;
}

function renderThread(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Readout />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  FakeEventSource.instances = [];
  vi.unstubAllGlobals();
});

describe('sendPersonalMessage', () => {
  it('posts the body with a wire-shaped context', async () => {
    messagePost.mockResolvedValue(okResponse(thread('running')));
    await sendPersonalMessage('What is at risk here?', {
      workspaceId: 'ws_1',
      workspaceName: 'Harbor Health',
      source: { type: 'project', id: 'project_1', label: 'Fall fundraiser launch' },
    });
    expect(messagePost).toHaveBeenCalledWith({
      json: {
        body: 'What is at risk here?',
        context: { workspaceId: 'ws_1', source: { type: 'project', id: 'project_1' } },
      },
    });
  });

  it('omits context when there is none', async () => {
    messagePost.mockResolvedValue(okResponse(thread('running')));
    await sendPersonalMessage('Plan my afternoon');
    expect(messagePost).toHaveBeenCalledWith({ json: { body: 'Plan my afternoon' } });
  });
});

describe('usePersonalThread', () => {
  it('tails the stream while a turn is in flight and merges what arrives', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    chatGet.mockResolvedValue(okResponse(thread('running')));
    renderThread();

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('0');
    });
    expect(FakeEventSource.instances[0]?.url).toBe('/v1/me/athena/sessions/chat_1/stream');

    const listener = FakeEventSource.instances[0]?.listeners.get('response');
    act(() => {
      listener?.({
        data: JSON.stringify({
          id: 'act_1',
          sessionId: 'chat_1',
          type: 'response',
          body: { text: 'Two things.', author: 'athena' },
          createdAt: '2026-09-13T10:00:01.000Z',
        }),
      } as MessageEvent);
    });
    expect(screen.getByTestId('count')).toHaveTextContent('1');
  });

  it('opens no stream for a settled thread', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    chatGet.mockResolvedValue(okResponse(thread('completed')));
    renderThread();

    await waitFor(() => {
      expect(screen.getByTestId('count')).toHaveTextContent('0');
    });
    expect(FakeEventSource.instances).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @docket/web exec vitest run tests/athena/thread-defs.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Add the query key and export the mapper**

In `apps/web/src/lib/query-keys.ts`, directly after `athena: () => ['me', 'athena'] as const,` add:

```ts
  /** The person's one Athena conversation. */
  athenaChat: () => ['me', 'athena', 'chat'] as const,
```

In `apps/web/src/lib/athena/query-defs.ts`, rename the private `apiContext` to an export and keep its body:

```ts
/** Strip display-only labels so a context matches the API's invocation shape. */
export function toInvocationContext(
  context?: PersonalAthenaContext,
): AthenaInvocationContext | undefined {
```

Update the two call sites in that file (`create` and any other) from `apiContext(` to `toInvocationContext(`.

- [ ] **Step 4: Write the hook**

```ts
// apps/web/src/lib/athena/thread-defs.ts
'use client';

/**
 * The person's one Athena conversation: a live read with an SSE tail while a turn is in flight.
 *
 * The poll is the delivery guarantee; the stream only makes it faster. The API closes the stream
 * when the session settles, so the subscription exists only while the thread reports a
 * non-terminal status.
 */
import type { AthenaSessionDetailOut, SessionActivityOut } from '@docket/athena/agent-contract';
import { useQueryClient, type QueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useEffect } from 'react';

import { api } from '@/lib/api';
import { readProblemError } from '@/lib/problem';
import { apiQueryOptions, STALE } from '@/lib/query-core';
import { queryKeys, useLiveApiQuery } from '@/lib/query';

import type { PersonalAthenaContext } from './presentation';
import { toInvocationContext } from './query-defs';

/** Session states after which the API closes the activity stream. */
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'canceled']);

/** SSE event names, one per activity type. */
const ACTIVITY_EVENTS = ['thought', 'action', 'response', 'elicitation', 'error'] as const;

/** Poll cadence while Athena is working. */
const ACTIVE_POLL_MS = 2_000;

/** Poll cadence for an idle thread. */
const IDLE_POLL_MS = 10_000;

/** Definition for `GET /v1/me/athena/chat`. */
export function personalThreadDef() {
  return apiQueryOptions<AthenaSessionDetailOut>(
    queryKeys.athenaChat(),
    () => api.v1.me.athena.chat.$get({ query: {} }),
    'Could not open the conversation.',
    { staleTime: STALE.realtime },
  );
}

/**
 * Append one message to the conversation and drive a turn over it.
 *
 * @param body - What the person wrote.
 * @param context - The attached page, if any; labels are stripped before sending.
 * @returns the updated conversation, for the caller to write into the cache.
 * @throws the problem-detail error when the API refuses the message.
 */
export async function sendPersonalMessage(
  body: string,
  context?: PersonalAthenaContext,
): Promise<AthenaSessionDetailOut> {
  const invocation = toInvocationContext(context);
  const response = await api.v1.me.athena.chat.messages.$post({
    json: { body, ...(invocation ? { context: invocation } : {}) },
  });
  if (!response.ok) throw await readProblemError(response, 'Athena could not answer right now.');
  return await response.json();
}

/** Insert one streamed activity into the cached conversation, deduplicating by id. */
function mergeActivity(queryClient: QueryClient, activity: SessionActivityOut): void {
  queryClient.setQueryData<AthenaSessionDetailOut>(queryKeys.athenaChat(), (thread) => {
    if (!thread || thread.id !== activity.sessionId) return thread;
    const existing = thread.activities.findIndex((entry) => entry.id === activity.id);
    if (existing >= 0) {
      const activities = thread.activities.map((entry, index) =>
        index === existing ? activity : entry,
      );
      return { ...thread, activities };
    }
    const activities = [...thread.activities, activity].sort((a, b) => a.id.localeCompare(b.id));
    return { ...thread, activities };
  });
}

/** Subscribe to the conversation's stream while a turn is in flight. */
function usePersonalStream(thread: AthenaSessionDetailOut | undefined): void {
  const queryClient = useQueryClient();
  const sessionId = thread && !TERMINAL_STATUSES.has(thread.status) ? thread.id : null;
  useEffect(() => {
    if (sessionId === null) return;
    const source = new EventSource(
      `/v1/me/athena/sessions/${encodeURIComponent(sessionId)}/stream`,
    );
    const merge = (event: MessageEvent): void => {
      try {
        mergeActivity(queryClient, JSON.parse(String(event.data)) as SessionActivityOut);
      } catch {
        // A malformed frame is dropped; the poll delivers the activity on its next pass.
      }
    };
    for (const eventName of ACTIVITY_EVENTS) source.addEventListener(eventName, merge);
    source.onerror = () => {
      source.close();
      void queryClient.invalidateQueries({ queryKey: queryKeys.athenaChat() });
    };
    return () => {
      source.close();
    };
  }, [queryClient, sessionId]);
}

/** The conversation as a live read: focus-gated polling plus the stream. */
export function usePersonalThread(): UseQueryResult<AthenaSessionDetailOut> {
  const queryClient = useQueryClient();
  // The cached thread decides the cadence before this render's query result exists; the query's
  // own subscription re-renders the hook when the status changes, so the interval follows.
  const cached = queryClient.getQueryData<AthenaSessionDetailOut>(queryKeys.athenaChat());
  const active = cached ? !TERMINAL_STATUSES.has(cached.status) : false;
  const query = useLiveApiQuery(personalThreadDef(), active ? ACTIVE_POLL_MS : IDLE_POLL_MS);
  usePersonalStream(query.data);
  return query;
}
```

Check the `AthenaSessionDetailOut` status union in `domains/athena/src/contracts/agent.ts` (line ~479); if its `status` values differ from `completed | failed | canceled`, use its terminal members in `TERMINAL_STATUSES`.

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm --filter @docket/web exec vitest run tests/athena/thread-defs.test.tsx && pnpm typecheck`
Expected: PASS, 4 tests; typecheck exit 0.

- [ ] **Step 6: Commit**

Write `/tmp/msg-task6.txt`:

```
feat(athena): Read the personal conversation live from any surface

Add the typed read, send, and stream hook for the person's one Athena conversation, against the
personal chat routes rather than the workspace-scoped thread. Activities arrive over the session
stream while a turn is in flight and the focus-gated poll remains the delivery guarantee. The
rail and Today switch to this hook in Phase 1.

Docs-impact: Not needed - data hook with no surface change
Co-authored-by: Claude Fable 5.1 <noreply@anthropic.com>
```

Run:

```bash
git restore --staged . && git add apps/web/src/lib/athena/thread-defs.ts apps/web/src/lib/athena/query-defs.ts apps/web/src/lib/query-keys.ts apps/web/tests/athena/thread-defs.test.tsx && git commit -F /tmp/msg-task6.txt
```

---

### Task 7: Browser journey: the panel keeps its place

**Files:**

- Create: `apps/web/e2e/athena/companion-context.spec.ts`

**Interfaces:**

- Consumes: `signUpAndOnboard` from `../helpers/app`, `expect`/`test` from `../helpers/fixtures`, and the route fixture pattern in `apps/web/e2e/athena/athena-personal.spec.ts`.

- [ ] **Step 1: Write the journey**

```ts
// apps/web/e2e/athena/companion-context.spec.ts
import type { Page, Route } from '@playwright/test';

import { signUpAndOnboard } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';

const createdAt = '2026-09-13T09:00:00.000Z';

/** Serve one piece of waiting Athena work so the rail has something to select. */
async function installAthenaFixture(page: Page, orgId: string): Promise<void> {
  const session = {
    id: 'athena_companion_session',
    kind: 'job',
    status: 'awaiting_approval',
    queueState: 'needs_you',
    objective: 'Draft sponsor outreach and reschedule printing',
    context: { workspaceId: orgId },
    workspace: { id: orgId, name: 'Personal workspace' },
    startedAt: createdAt,
    endedAt: null,
    createdAt,
  } as const;
  const detail = { ...session, activities: [], result: null } as const;

  await page.route('**/v1/me/athena**', async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown): Promise<void> =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (request.method() === 'GET' && path === '/v1/me/athena/pulse') {
      await json({ needsYou: 1, working: 0 });
      return;
    }
    if (request.method() === 'GET' && path === '/v1/me/athena') {
      await json({
        counts: { needsYou: 1, working: 0, finished: 0 },
        currentChat: null,
        sessions: { needsYou: [session], working: [], finished: [] },
      });
      return;
    }
    if (request.method() === 'GET' && path === `/v1/me/athena/sessions/${session.id}`) {
      await json(detail);
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
}

test('the Athena panel keeps its selected work while the person moves between pages', async ({
  page,
}) => {
  const { orgId } = await signUpAndOnboard(page, 'athena-companion');
  await installAthenaFixture(page, orgId);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/today');
  await page.keyboard.press('Meta+J');
  const rail = page.getByRole('complementary', { name: 'Athena' });
  await rail.getByRole('button', { name: /Draft sponsor outreach/ }).click();
  await expect(rail.getByRole('heading', { name: /Draft sponsor outreach/ })).toBeVisible();

  // Client-side navigation through the sidebar; a full page load would be a different test.
  await page.getByRole('navigation').getByRole('link', { name: /Inbox/ }).first().click();
  await expect(page).toHaveURL(/inbox|triage/);

  await expect(rail.getByRole('heading', { name: /Draft sponsor outreach/ })).toBeVisible();
  await expect(rail.getByRole('button', { name: 'Back' })).toBeVisible();
});
```

If the sidebar's Inbox link carries a different accessible name, read it from `apps/web/src/components/app-shell-frame.tsx` (search `Inbox`) and use that name; the assertion on the URL must match the route the link points to.

- [ ] **Step 2: Run it**

Follow `docs/engineering/ui-verification.md` to start the stack, then:

Run: `pnpm --filter @docket/web exec playwright test e2e/athena/companion-context.spec.ts`
Expected: 1 passed.

- [ ] **Step 3: Commit**

Write `/tmp/msg-task7.txt`:

```
feat(athena): Prove the Athena panel stays put across navigation

Add a browser journey that selects a piece of Athena work in the rail, navigates through the
sidebar, and checks the same work is still open. It guards the companion design's first property
against the route-keyed reset the old panel had.

Docs-impact: Not needed - test only
Co-authored-by: Claude Fable 5.1 <noreply@anthropic.com>
```

Run:

```bash
git restore --staged . && git add apps/web/e2e/athena/companion-context.spec.ts && git commit -F /tmp/msg-task7.txt
```

---

### Task 8: Full validation and the work log

**Files:**

- Modify: `docs/WORKLOG.md` (the `[ATHENA-COMPANION-001]` entry)

- [ ] **Step 1: Run the full gates**

Run: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test`
Expected: all exit 0. If `pnpm test` replays a turbo cache, run `pnpm test -- --force`.

- [ ] **Step 2: Update the work log**

In the `[ATHENA-COMPANION-001]` entry: tick the Phase 0 subtask, set `Status` to `IN_PROGRESS`, and add under Notes:

```markdown
- **Phase 0 landed (2026-09-13)**: page context provider, navigation-stable panel, context chip
  in the rail composer, personal thread hook, browser journey. Validation: root typecheck, lint,
  format:check, test, and `e2e/athena/companion-context.spec.ts` all green.
```

- [ ] **Step 3: Commit**

Write `/tmp/msg-task8.txt`:

```
chore(athena): Record the companion's Phase 0 in the work log

Tick the context-spine phase in the Athena companion entry and note the validation that ran:
root typecheck, lint, format check, unit tests, and the new browser journey for the panel
surviving navigation.

Co-authored-by: Claude Fable 5.1 <noreply@anthropic.com>
```

Run:

```bash
git restore --staged . && git add docs/WORKLOG.md && git commit -F /tmp/msg-task8.txt
```

Do not push. Rebase onto `origin/main` and confirm `git rev-list --merges --count origin/main..HEAD` prints `0` before handing off.
