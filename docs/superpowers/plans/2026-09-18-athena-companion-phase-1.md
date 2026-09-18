# Athena Companion Phase 1 (Companion Thread) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ⌘J opens a conversation. The rail's Athena panel is the person's one thread, with the page chip above its composer and page-aware suggestions when empty; the job queue leaves the rail.

**Architecture:** The planning canvas already established the shape: a route hands the rail a `PlanRailConversation` (mark, "open the page" link, `AthenaConversation`) through `provideRailContent`. Phase 1 generalises that into `AthenaRailConversation`, the rail's default body, and slims `AthenaPanelProvider` to what the thread needs (page context, chip state, launch draft, rail status, rail content). `AthenaConversation` gains a chip slot, page-aware suggestions, and sends through the personal message route so a message can carry its context. Athena becomes the first rail panel. `/athena` (queue + workbench) is untouched until Phase 2.

**Tech Stack:** Next.js App Router, React 19, TanStack Query (`apps/web/src/lib/query.ts`), Hono RPC (`api.v1.*`), Vitest + Testing Library under `apps/web/tests/`, Playwright under `apps/web/e2e/`.

**Spec:** `docs/superpowers/specs/2026-09-12-athena-companion-design.md` §2.1, §4.1, §4.2, §4.4, §4.5 (suggestions), §5 Phase 1.

## Global Constraints

- Tests live in `apps/web/tests/**`, never colocated in `src/`.
- Never assert exact UI copy in tests; assert roles, accessible names by regex, values, hrefs, presence.
- Every exported function, type, and component gets TSDoc.
- No chained or nested ternaries; no inline object types as parameter annotations or generic constraints.
- UI copy is application-owned and plain: no "session", "job", "tool", "execute", "queue" shown to a person.
- Data access only through `apiQueryOptions` / `useApiQuery` / `useLiveApiQuery` / `useApiMutation`; never `useEffect` + `fetch` in a component.
- Use shared primitives from `@docket/ui`; no hand-rolled chips, menus, or surfaces.
- No new entries or larger numbers in `complexity-debt.json`; refactor instead.
- The app never overflows horizontally at any width; the rail is `clamp(17.5rem, 17vw, 22rem)` (280px at 1440).
- `pnpm` only; validate with root `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`.
- Commits: `feat(athena): …` / `fix(athena): …` with a body ≥ 100 characters, a `Docs-impact:` trailer, and `Co-authored-by: Claude Fable 5.1 <noreply@anthropic.com>`; stage and commit in one chain `git restore --staged . && git add <paths> && git commit -F <file>`. Never push.
- No `// TODO`, no stubs, no skipped tests.

## Decisions carried from the design (defaults stand)

- Athena is the first rail panel; the rail opens on Athena when the thread needs the person, on Agenda otherwise.
- The thread stays on the existing `AthenaConversation` component. The org chat route is documented as a compatibility door onto the same personal session, so no thread migration happens in this phase; `thread-defs.ts` remains for Phase 2's cards.
- Sending goes through `POST /v1/me/athena/chat/messages`, which accepts `{ body, context }`, followed by a re-read through the door the thread is cached under. That is how a message carries its page.
- The rail's job queue, launch composer, "Back", counts, and "Open full" are removed from the rail. `/athena` keeps them until Phase 2.

---

## File Structure

| File                                                                   | Responsibility                                                                                                                    |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/tests/athena/page-context.test.tsx` (modify)                 | Add the combined "drawer over a page whose label updates" case from the Phase 0 final review.                                     |
| `apps/web/src/lib/athena/suggestions.ts` (create)                      | `athenaSuggestions(context)`: three prompts for a page context. Pure.                                                             |
| `apps/web/src/lib/athena/chat-defs.ts` (modify)                        | `sendOrgChatMessage(orgId, body, context?)` posts to the personal route with context and re-reads the org door.                   |
| `apps/web/src/components/athena/athena-conversation.tsx` (modify)      | `context` + chip props, suggestions in the empty state, sends with context.                                                       |
| `apps/web/src/components/athena/athena-rail-conversation.tsx` (create) | The rail's default body: mark, Talk, open-wide link, `AthenaConversation` with the chip. Generalised from `PlanRailConversation`. |
| `apps/web/src/components/plan-canvas/plan-conversation.tsx` (modify)   | `PlanRailConversation` delegates to `AthenaRailConversation` with its own empty state.                                            |
| `apps/web/src/components/athena/athena-panel-provider.tsx` (modify)    | Rail renders `AthenaRailConversation` by default; queue, selection, launch composer, and their state leave the provider.          |
| `apps/web/src/components/app-shell-frame.tsx` (modify)                 | Athena first in the rail; default panel follows its status.                                                                       |
| `apps/web/tests/athena/suggestions.test.ts` (create)                   | Suggestion mapping.                                                                                                               |
| `apps/web/tests/athena/chat-defs.test.tsx` (create or extend)          | Send posts to the personal route with a wire-shaped context and re-reads.                                                         |
| `apps/web/tests/athena/athena-conversation.test.tsx` (modify)          | Chip slot renders; a suggestion fills and focuses the composer; send carries context.                                             |
| `apps/web/tests/athena/rail-conversation.test.tsx` (create)            | Header, open-wide href, launch draft lands in the composer.                                                                       |
| `apps/web/tests/athena/panel-provider.test.tsx` (modify)               | Queue tests removed; rail shows the thread; ⌘J reveals; chip detach.                                                              |
| `apps/web/tests/components/app-shell-frame.test.tsx` (modify)          | Panel order and default.                                                                                                          |
| `apps/web/e2e/athena/athena-personal.spec.ts` (modify)                 | Rail expectations: the thread and the open-wide link.                                                                             |
| `apps/web/e2e/athena/companion-context.spec.ts` (modify)               | Persistence proven on the composer draft and chip instead of a selected job.                                                      |
| `docs/WORKLOG.md` (modify)                                             | Phase 1 ticked; the ⌘J decision recorded.                                                                                         |

---

### Task 1: Close the Phase 0 review's test gap

**Files:**

- Test: `apps/web/tests/athena/page-context.test.tsx`

**Interfaces:** consumes `PageContextProvider`, `PageSource`, `usePageContext` from `apps/web/src/components/athena/page-context.tsx`.

- [ ] **Step 1: Add the combined case**

Append inside `describe('PageContextProvider', …)`:

```tsx
it('keeps a drawer active while the page under it changes its label', () => {
  const view = render(
    <PageContextProvider workspace={{ workspaceId: 'ws_1' }}>
      <PageSource type="task" id="task_1" />
      <PageSource type="calendar_item" id="cal_1" label="Venue walkthrough" />
      <Readout />
    </PageContextProvider>,
  );
  expect(readContext()).toEqual({
    workspaceId: 'ws_1',
    source: { type: 'calendar_item', id: 'cal_1', label: 'Venue walkthrough' },
  });

  view.rerender(
    <PageContextProvider workspace={{ workspaceId: 'ws_1' }}>
      <PageSource type="task" id="task_1" label="Confirm venue contract" />
      <PageSource type="calendar_item" id="cal_1" label="Venue walkthrough" />
      <Readout />
    </PageContextProvider>,
  );
  expect(readContext()).toEqual({
    workspaceId: 'ws_1',
    source: { type: 'calendar_item', id: 'cal_1', label: 'Venue walkthrough' },
  });

  view.rerender(
    <PageContextProvider workspace={{ workspaceId: 'ws_1' }}>
      <PageSource type="task" id="task_1" label="Confirm venue contract" />
      <Readout />
    </PageContextProvider>,
  );
  expect(readContext()).toEqual({
    workspaceId: 'ws_1',
    source: { type: 'task', id: 'task_1', label: 'Confirm venue contract' },
  });
});
```

Rename the existing test `keeps the source when only its label changes` to `carries a label that arrives after the page mounts` and leave its body as is; it documents behaviour rather than guarding a regression.

- [ ] **Step 2: Run**

Run: `pnpm --filter @docket/web exec vitest run tests/athena/page-context.test.tsx`
Expected: PASS.

- [ ] **Step 3: Commit**

```
fix(athena): Prove a drawer keeps its place over a page that renames itself

Add the case the Phase 0 review asked for: a calendar item opened over a task stays the active
page while the task's label arrives late, and closing the item returns to the task. The earlier
label-only case is renamed to say what it documents.

Docs-impact: Not needed - test only
Co-authored-by: Claude Fable 5.1 <noreply@anthropic.com>
```

`git restore --staged . && git add apps/web/tests/athena/page-context.test.tsx && git commit -F <file>`

---

### Task 2: Page-aware suggestions

**Files:**

- Create: `apps/web/src/lib/athena/suggestions.ts`
- Test: `apps/web/tests/athena/suggestions.test.ts`

**Interfaces:**

- Produces: `athenaSuggestions(context: PersonalAthenaContext | null): readonly string[]` (always exactly three).

- [ ] **Step 1: Failing test**

```ts
// apps/web/tests/athena/suggestions.test.ts
import { describe, expect, it } from 'vitest';

import { athenaSuggestions } from '../../src/lib/athena/suggestions';

describe('athenaSuggestions', () => {
  it('offers three prompts for a project', () => {
    const prompts = athenaSuggestions({
      workspaceId: 'ws_1',
      source: { type: 'project', id: 'p1', label: 'Fall fundraiser launch' },
    });
    expect(prompts).toHaveLength(3);
    expect(new Set(prompts).size).toBe(3);
  });

  it('offers different prompts for a task than for a project', () => {
    const project = athenaSuggestions({
      workspaceId: 'ws_1',
      source: { type: 'project', id: 'p1' },
    });
    const task = athenaSuggestions({ workspaceId: 'ws_1', source: { type: 'task', id: 't1' } });
    expect(task).not.toEqual(project);
    expect(task).toHaveLength(3);
  });

  it('offers day-level prompts without a page', () => {
    expect(athenaSuggestions(null)).toHaveLength(3);
    expect(athenaSuggestions({ workspaceId: 'ws_1' })).toEqual(athenaSuggestions(null));
  });
});
```

- [ ] **Step 2: Run, expect module-not-found failure**

Run: `pnpm --filter @docket/web exec vitest run tests/athena/suggestions.test.ts`

- [ ] **Step 3: Implement**

```ts
// apps/web/src/lib/athena/suggestions.ts
/**
 * What Athena offers to do on an empty thread, from the page the person is on.
 *
 * Three prompts, always. A prompt is a complete request the person could have typed, so choosing
 * one fills the composer rather than sending on its own.
 */
import type { PersonalAthenaContext, PersonalAthenaSource } from './presentation';

type SourceKind = PersonalAthenaSource['type'];

const BY_KIND: Readonly<Record<SourceKind, readonly [string, string, string]>> = {
  project: [
    'What is at risk in this project?',
    'Summarize what changed this week',
    'Draft an update for the team',
  ],
  initiative: [
    'Which projects here are behind?',
    'Summarize progress against the target',
    'Draft a status update for leadership',
  ],
  program: [
    'What needs attention across this program?',
    'Summarize what changed this week',
    'Draft an update for the team',
  ],
  task: ['Break this into steps', 'Find related work', 'What is blocking this?'],
  calendar_item: [
    'Prepare me for this',
    'Find the work connected to this',
    'Draft a follow-up after this',
  ],
  stream_event: ['Turn this into a task', 'Find the work this relates to', 'Draft a reply'],
};

const DAY: readonly [string, string, string] = [
  'Plan my afternoon',
  'What needs me today?',
  'What did I finish this week?',
];

/**
 * Three prompts for the given page, or for the day when there is no page.
 *
 * @param context - The merged page context, or null.
 * @returns exactly three distinct prompts.
 */
export function athenaSuggestions(context: PersonalAthenaContext | null): readonly string[] {
  const kind = context?.source?.type;
  if (!kind) return DAY;
  return BY_KIND[kind];
}
```

- [ ] **Step 4: Run, expect PASS. Commit**

```
feat(athena): Suggest what to ask from the page a person is on

Add the pure mapping from a page context to three prompts: a project offers risk, change, and
update requests; a task offers steps, related work, and blockers; without a page the prompts are
about the day. The empty thread renders these in the next commit.

Docs-impact: Not needed - pure helper; the surface change is documented with its host
Co-authored-by: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 3: A message carries its page

**Files:**

- Modify: `apps/web/src/lib/athena/chat-defs.ts` (`sendOrgChatMessage`)
- Test: `apps/web/tests/athena/chat-defs.test.tsx` (create if absent; if `apps/web/tests/athena/athena-conversation.test.tsx` already mocks `../../src/lib/api`, follow the same mock shape)

**Interfaces:**

- Consumes: `toInvocationContext` from `apps/web/src/lib/athena/query-defs.ts`; `api.v1.me.athena.chat.messages.$post({ json })`; `fetchOrgChatThread(orgId)`.
- Produces: `sendOrgChatMessage(orgId: string, body: string, context?: PersonalAthenaContext | null): Promise<AgentSessionDetailOut>`.

- [ ] **Step 1: Failing test**

```tsx
// apps/web/tests/athena/chat-defs.test.tsx
import { describe, expect, it, vi } from 'vitest';

import { okResponse } from '../support/query';

const { orgChatGet, personalPost } = vi.hoisted(() => ({
  orgChatGet: vi.fn(),
  personalPost: vi.fn(),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: { ':orgId': { sessions: { chat: { $get: orgChatGet } } } },
      me: { athena: { chat: { messages: { $post: personalPost } } } },
    },
  },
}));

import { sendOrgChatMessage } from '../../src/lib/athena/chat-defs';

const thread = {
  id: 'chat_1',
  kind: 'chat',
  status: 'running',
  objective: 'Chat',
  startedAt: '2026-09-18T10:00:00.000Z',
  endedAt: null,
  createdAt: '2026-09-18T10:00:00.000Z',
  activities: [],
  result: null,
};

describe('sendOrgChatMessage', () => {
  it('posts through the personal door with a wire-shaped context, then re-reads the thread', async () => {
    personalPost.mockResolvedValue(okResponse(thread));
    orgChatGet.mockResolvedValue(okResponse(thread));
    const result = await sendOrgChatMessage('01HZZZZZZZZZZZZZZZZZZZZZZZ', 'What is at risk here?', {
      workspaceId: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
      workspaceName: 'Harbor Health',
      source: { type: 'project', id: 'project_1', label: 'Fall fundraiser launch' },
    });
    expect(personalPost).toHaveBeenCalledWith({
      json: {
        body: 'What is at risk here?',
        context: {
          workspaceId: '01HZZZZZZZZZZZZZZZZZZZZZZZ',
          source: { type: 'project', id: 'project_1' },
        },
      },
    });
    expect(orgChatGet).toHaveBeenCalledWith({ param: { orgId: '01HZZZZZZZZZZZZZZZZZZZZZZZ' } });
    expect(result.id).toBe('chat_1');
  });

  it('omits context when the message has none', async () => {
    personalPost.mockResolvedValue(okResponse(thread));
    orgChatGet.mockResolvedValue(okResponse(thread));
    await sendOrgChatMessage('01HZZZZZZZZZZZZZZZZZZZZZZZ', 'Plan my afternoon');
    expect(personalPost).toHaveBeenCalledWith({ json: { body: 'Plan my afternoon' } });
  });
});
```

If `AthenaInvocationContext.parse` rejects the id shape, use the ULID fixture already used in `apps/web/tests/athena/thread-defs.test.tsx`.

- [ ] **Step 2: Run, expect failure (personalPost not called / signature)**

- [ ] **Step 3: Implement**

Replace `sendOrgChatMessage` in `chat-defs.ts`:

```ts
/**
 * Append one entry to the conversation, carrying the page it was asked from, and drive a turn.
 *
 * The write goes through the personal door because that is the one that accepts a page context;
 * the thread is then re-read through the door it is cached under so every reader sees one shape.
 *
 * @param orgId - The workspace whose door the thread is read through.
 * @param body - The message content, attributed to the caller.
 * @param context - The page attached to the message, if any; display labels are stripped.
 * @returns the updated thread, for the caller to write into the cache.
 * @throws the problem-detail error when the API refuses the message or the re-read.
 */
export async function sendOrgChatMessage(
  orgId: string,
  body: string,
  context?: PersonalAthenaContext | null,
): Promise<AgentSessionDetailOut> {
  const invocation = toInvocationContext(context ?? undefined);
  const response = await api.v1.me.athena.chat.messages.$post({
    json: { body, ...(invocation ? { context: invocation } : {}) },
  });
  if (!response.ok) throw await readProblemError(response, 'Athena could not answer right now.');
  return await fetchOrgChatThread(orgId);
}
```

Add imports: `import type { PersonalAthenaContext } from './presentation';` and `import { toInvocationContext } from './query-defs';`. Update the module docblock's mention of the org write route.

- [ ] **Step 4: Run the new test and `tests/athena/athena-conversation.test.tsx` (its mock of `api` must gain `me.athena.chat.messages.$post` and its send assertions must move to the personal mock). Expect PASS. `pnpm typecheck`. Commit**

```
feat(athena): Let a message tell Athena which page it was asked from

Sending from the conversation now goes through the personal message route, which accepts the
attached page, and re-reads the thread through the door it is cached under. The org write route
took only the text, so a page chip had no way to reach Athena.

Docs-impact: Not needed - transport change under the companion design's context model
Co-authored-by: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 4: The conversation wears the chip and offers suggestions

**Files:**

- Modify: `apps/web/src/components/athena/athena-conversation.tsx`
- Test: `apps/web/tests/athena/athena-conversation.test.tsx`

**Interfaces:**

- Consumes: `AthenaContextChip` (`athena-context-chip.tsx`), `athenaSuggestions` (Task 2), `sendOrgChatMessage(orgId, body, context)` (Task 3).
- Produces on `AthenaConversationProps`:
  - `context?: PersonalAthenaContext | null` — the page to attach to the next message and to draw suggestions from.
  - `contextAttached?: boolean` (default `true`), `onDetachContext?: () => void`, `onAttachContext?: () => void`.
  - `suggestions?: boolean` (default `true`) — whether the empty state offers prompts.

- [ ] **Step 1: Failing tests**

Add to `athena-conversation.test.tsx` (extend the existing `api` mock with `me: { athena: { chat: { messages: { $post: personalPost } } } }` and route the existing send assertions to it):

```tsx
it('shows the attached page above the composer and sends it with the message', async () => {
  chatGet.mockResolvedValue(okResponse(thread([])));
  personalPost.mockResolvedValue(okResponse(thread([])));
  renderConversation({
    context: {
      workspaceId: ORG_ID,
      source: { type: 'project', id: 'project_1', label: 'Fall fundraiser launch' },
    },
  });
  const form = await screen.findByRole('form', { name: /Message Athena/ });
  expect(within(form).getByRole('group', { name: /Fall fundraiser launch/ })).toBeVisible();

  fireEvent.change(screen.getByLabelText('Message Athena'), {
    target: { value: 'What is at risk?' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));

  await waitFor(() => {
    expect(personalPost).toHaveBeenCalledWith({
      json: {
        body: 'What is at risk?',
        context: { workspaceId: ORG_ID, source: { type: 'project', id: 'project_1' } },
      },
    });
  });
});

it('fills the composer from a suggestion without sending', async () => {
  chatGet.mockResolvedValue(okResponse(thread([])));
  renderConversation({
    context: {
      workspaceId: ORG_ID,
      source: { type: 'task', id: 'task_1', label: 'Confirm venue' },
    },
  });
  const list = await screen.findByRole('list', { name: /Suggestions/ });
  const first = within(list).getAllByRole('button')[0];
  expect(first).toBeDefined();
  fireEvent.click(first as HTMLElement);
  expect(screen.getByLabelText('Message Athena')).toHaveValue(first?.textContent);
  expect(personalPost).not.toHaveBeenCalled();
});
```

`renderConversation(props)` is a small helper wrapping `AthenaConversation` in a `QueryClientProvider` with `orgId={ORG_ID}`; write it if the file has none. Give the composer `<form aria-label="Message Athena">` (see Step 3) so the `form` role query works.

- [ ] **Step 2: Run, expect failures (no group in form; no list)**

- [ ] **Step 3: Implement**

In `athena-conversation.tsx`:

Add imports:

```ts
import { AthenaContextChip } from '@/components/athena/athena-context-chip';
import { athenaSuggestions } from '@/lib/athena/suggestions';
import type { PersonalAthenaContext } from '@/lib/athena/presentation';
```

Extend `AthenaConversationProps`:

```ts
  /** The page to attach to the next message and to draw suggestions from. */
  context?: PersonalAthenaContext | null | undefined;
  /** Whether the next message carries `context`. Defaults to attached. */
  contextAttached?: boolean | undefined;
  /** Drop the page for the next message. */
  onDetachContext?: (() => void) | undefined;
  /** Put the page back. */
  onAttachContext?: (() => void) | undefined;
  /** Whether an empty thread offers prompts. Defaults to true. */
  suggestions?: boolean | undefined;
```

Destructure them with defaults `context = null, contextAttached = true, suggestions = true`.

In `send`, pass the context: `commitThread(await sendOrgChatMessage(orgId, text, contextAttached ? context : null));` and add `context`, `contextAttached` to its dependency array. `sendWidgetMessage` in `useThreadWrites` keeps calling `sendOrgChatMessage(orgId, text)`.

Replace the empty-state branch:

```tsx
        ) : (
          <div className="flex flex-col gap-3">
            <EmptyState icon={Sparkles} title={empty.title} body={empty.body} frame="none" />
            {suggestions ? (
              <ul aria-label="Suggestions" className="flex flex-col gap-1">
                {athenaSuggestions(context).map((prompt) => (
                  <li key={prompt}>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 w-full justify-start"
                      onClick={() => {
                        setDraft(prompt);
                        composerRef.current?.querySelector('textarea')?.focus({ preventScroll: true });
                      }}
                    >
                      <span className="truncate">{prompt}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
```

Give the form an accessible name and the chip slot:

```tsx
      <form
        ref={composerRef}
        aria-label="Message Athena"
        className={cn(
          surfaceToneColor('prominent'),
          'focus-within:ring-ring mt-2 flex flex-col gap-1 rounded-lg p-2 transition-shadow focus-within:ring-1',
        )}
        onSubmit={…}
      >
        {context ? (
          <div className="px-1 pt-1">
            <AthenaContextChip
              context={context}
              attached={contextAttached}
              onDetach={onDetachContext ?? (() => {})}
              onAttach={onAttachContext ?? (() => {})}
            />
          </div>
        ) : null}
        <MentionTextarea … />
```

If the file trips the complexity ledger, move the suggestions block into a small `ConversationSuggestions` component in the same file (props: `context`, `onPick(prompt)`), and the chip slot into `ComposerContext`.

- [ ] **Step 4: Run `tests/athena/athena-conversation.test.tsx`, eslint on the two files, `pnpm typecheck`. Expect PASS. Commit**

```
feat(athena): Show the attached page in the conversation and offer what to ask

The conversation's composer now carries the page chip, sends the page with the message, and an
empty thread offers three prompts drawn from the page: risk, change, and update requests on a
project; steps, related work, and blockers on a task; the day when there is no page. Choosing a
prompt fills the composer and leaves sending to the person.

Docs-impact: Updated - docs/superpowers/specs/2026-09-12-athena-companion-design.md
Co-authored-by: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 5: The rail's default body is the conversation

**Files:**

- Create: `apps/web/src/components/athena/athena-rail-conversation.tsx`
- Modify: `apps/web/src/components/plan-canvas/plan-conversation.tsx` (`PlanRailConversation` becomes a thin wrapper)
- Modify: `apps/web/src/components/athena/athena-panel-provider.tsx`
- Test: `apps/web/tests/athena/rail-conversation.test.tsx` (create), `apps/web/tests/athena/panel-provider.test.tsx` (rewrite the queue-era tests)

**Interfaces:**

- Consumes: `AthenaConversation` with Task 4's props; `VoiceLaunch({ workspaceId })` from `./voice-launch`; `athenaHref(context)`; `OpenInNew`, `Sparkles` icons.
- Produces:
  - `AthenaRailConversation({ orgId, emptyState?, suggestions? })` — reads `useAthenaPanel()` for `context`, `contextAttached`, `attachContext`, `detachContext`, `launchDraft`.
  - `AthenaPanelValue` shrinks to: `context`, `launchDraft`, `railStatus`, `contextAttached`, `attachContext`, `detachContext`, `openAthena`, `closeAthena`, `railContent`, `provideRailContent`. Removed: `selectedId`, `selected`, `queue`, `detailPending`, `detailError`, `feedback`, `pending`, `createPending`, `selectSession`, `sendMessage`, `lifecycle`, `decide`, `create`.
  - `AthenaPanelProviderProps.railVisible` stays (the pulse keeps polling; nothing else is gated on it now, so it may be removed if no consumer remains; the shell passes it today, keep it and use it to gate nothing).

- [ ] **Step 1: Failing tests**

`apps/web/tests/athena/rail-conversation.test.tsx`:

```tsx
import '@testing-library/jest-dom/vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { okResponse } from '../support/query';

const { chatGet, personalPost, pulseGet } = vi.hoisted(() => ({
  chatGet: vi.fn(),
  personalPost: vi.fn(),
  pulseGet: vi.fn(),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: { ':orgId': { sessions: { chat: { $get: chatGet } } } },
      me: { athena: { chat: { messages: { $post: personalPost } }, pulse: { $get: pulseGet } } },
    },
  },
}));

import { AthenaRailConversation } from '../../src/components/athena/athena-rail-conversation';
import { AthenaPanelProvider } from '../../src/components/athena/athena-panel-provider';
import { PageContextProvider, PageSource } from '../../src/components/athena/page-context';

const ORG_ID = '01HZZZZZZZZZZZZZZZZZZZZZZZ';

function thread() {
  return {
    id: 'chat_1',
    kind: 'chat',
    status: 'completed',
    objective: 'Chat',
    startedAt: '2026-09-18T10:00:00.000Z',
    endedAt: null,
    createdAt: '2026-09-18T10:00:00.000Z',
    activities: [],
    result: null,
  };
}

afterEach(cleanup);

describe('AthenaRailConversation', () => {
  it('names itself, links to the wide view for the workspace, and shows the page chip', async () => {
    chatGet.mockResolvedValue(okResponse(thread()));
    pulseGet.mockResolvedValue(okResponse({ needsYou: 0, working: 0 }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <PageContextProvider workspace={{ workspaceId: ORG_ID, workspaceName: 'Harbor Health' }}>
          <PageSource type="project" id="project_1" label="Fall fundraiser launch" />
          <AthenaPanelProvider railVisible onRevealRail={vi.fn()}>
            <AthenaRailConversation orgId={ORG_ID} />
          </AthenaPanelProvider>
        </PageContextProvider>
      </QueryClientProvider>,
    );
    const link = screen.getByRole('link', { name: /Open the Athena page/ });
    expect(link).toHaveAttribute('href', `/athena?workspace=${ORG_ID}`);
    const form = await screen.findByRole('form', { name: /Message Athena/ });
    expect(within(form).getByRole('group', { name: /Fall fundraiser launch/ })).toBeVisible();
  });
});
```

In `panel-provider.test.tsx`: delete the tests named `does not fetch the full queue…`, `replaces the queue with one selected session…`, `keeps the selected session when the shell rerenders…`, `keeps the selected session when the page underneath changes`, `starts new work with the open page as its context`, `opens a contextual composer in the rail…`, `uses owned copy when Athena's queue cannot load`, `keeps a Back path…`, `starts work without the page once the chip is detached`. Replace them with:

```tsx
it('shows the conversation in the rail by default', async () => {
  renderPanel();
  expect(await screen.findByRole('form', { name: /Message Athena/ })).toBeVisible();
  expect(screen.queryByRole('navigation', { name: /Athena work/ })).toBeNull();
});

it('seeds the composer from an open with an opening line', async () => {
  renderPanel();
  fireEvent.click(screen.getByRole('button', { name: 'Open contextual Athena' }));
  await waitFor(() => {
    expect(screen.getByLabelText('Message Athena')).toHaveValue('');
  });
  fireEvent.click(screen.getByRole('button', { name: 'Open with a line' }));
  await waitFor(() => {
    expect(screen.getByLabelText('Message Athena')).toHaveValue('Help me with this');
  });
});

it('keeps the composer draft when the page underneath changes', async () => {
  const view = renderPanelWithPage(
    <PageSource type="task" id="task_1" label="Confirm venue contract" />,
  );
  fireEvent.change(await screen.findByLabelText('Message Athena'), {
    target: { value: 'Half a thought' },
  });
  view.rerender(
    pageTree(<PageSource type="project" id="project_1" label="Fall fundraiser launch" />),
  );
  expect(screen.getByLabelText('Message Athena')).toHaveValue('Half a thought');
  expect(screen.getByRole('group', { name: /Fall fundraiser launch/ })).toBeVisible();
});
```

Update `transport()` to only need `pulse` (the provider no longer calls `queue`/`detail`; keep the other functions as `vi.fn()` so the type still satisfies `PersonalAthenaTransport`). Add an "Open with a line" button to `AthenaLaunchers` calling `openAthena({ workspaceId: ORG_ID }, 'Help me with this')`. `renderPanel` must now also mock `api` (the conversation reads the org door) exactly as `rail-conversation.test.tsx` does, and wrap in `PageContextProvider workspace={{ workspaceId: ORG_ID }}` so the rail has a workspace. Write `renderPanelWithPage(source)` and `pageTree(source)` helpers beside `renderPanel`.

- [ ] **Step 2: Run both files, expect failures (no form in the rail; removed value members referenced)**

- [ ] **Step 3: Create `athena-rail-conversation.tsx`**

```tsx
'use client';

/**
 * The rail's Athena panel: the one conversation, beside whatever the person is looking at.
 *
 * The header is the mark, Talk, and a way to the wide view. The body is the shared conversation
 * with the page chip above its composer. An "open Athena" that carries an opening line lands it in
 * the composer; a route with its own subject (a plan) passes a shorter empty state.
 */
import { OpenInNew, Sparkles } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import { type JSX, useEffect, useState } from 'react';

import AthenaConversation, {
  type ConversationEmptyState,
} from '@/components/athena/athena-conversation';
import { useAthenaPanel } from '@/components/athena/athena-panel-provider';
import { VoiceLaunch } from '@/components/athena/voice-launch';
import Link from '@/components/docket-link';
import { athenaHref } from '@/lib/athena/query-defs';

/** A draft handed to the composer; each new version replaces the text and focuses the field. */
interface DraftRequest {
  readonly text: string;
  readonly version: number;
}

/** The launch draft as a composer request: each non-empty draft is a new version. */
function useLaunchDraftRequest(launchDraft: string | null): DraftRequest | null {
  const [request, setRequest] = useState<DraftRequest | null>(null);
  useEffect(() => {
    if (launchDraft === null || launchDraft === '') return;
    setRequest((current) => ({ text: launchDraft, version: (current?.version ?? 0) + 1 }));
  }, [launchDraft]);
  return request;
}

/** Props for {@link AthenaRailConversation}. */
export interface AthenaRailConversationProps {
  /** The workspace whose door the thread is read through. */
  readonly orgId: string;
  /** What an empty thread says; a route with its own subject passes a shorter one. */
  readonly emptyState?: ConversationEmptyState | undefined;
  /** Whether an empty thread offers prompts. Defaults to true. */
  readonly suggestions?: boolean | undefined;
}

/** The rail's Athena panel body. */
export function AthenaRailConversation({
  orgId,
  emptyState,
  suggestions = true,
}: AthenaRailConversationProps): JSX.Element {
  const athena = useAthenaPanel();
  const draftRequest = useLaunchDraftRequest(athena.launchDraft);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-12 shrink-0 items-center gap-2 py-1 pr-1 pl-3">
        <Sparkles aria-hidden="true" className="text-primary size-4" />
        <span className="text-on-surface text-label-large min-w-0 flex-1 truncate">Athena</span>
        <VoiceLaunch workspaceId={orgId} />
        <Button variant="ghost" size="sm" iconOnly asChild>
          <Link
            href={athenaHref({ workspaceId: orgId })}
            aria-label="Open the Athena page"
            title="Open the Athena page"
          >
            <OpenInNew aria-hidden="true" className="size-4" />
          </Link>
        </Button>
      </div>
      <AthenaConversation
        orgId={orgId}
        className="min-h-0 flex-1 px-3 pb-3"
        draftRequest={draftRequest}
        context={athena.context}
        contextAttached={athena.contextAttached}
        onDetachContext={athena.detachContext}
        onAttachContext={athena.attachContext}
        suggestions={suggestions}
        {...(emptyState ? { emptyState } : {})}
      />
    </div>
  );
}
```

Check `VoiceLaunch`'s rendered size; if it is not an icon-sized control, pass whatever prop it offers for a compact variant or leave it as is and note it.

- [ ] **Step 4: Make `PlanRailConversation` delegate**

In `plan-conversation.tsx`, replace the body of `PlanRailConversation` with:

```tsx
return <AthenaRailConversation orgId={orgId} emptyState={PLAN_EMPTY_STATE} suggestions={false} />;
```

Remove the now-unused imports (`OpenInNew`, `Sparkles`, `Button`, `Link`, `athenaHref`, `useAthenaPanel` if unused, `useEffect`/`useRef`/`useState` as applicable, `PlanDraftRequest`), import `AthenaRailConversation`.

- [ ] **Step 5: Slim the provider and make the rail render the conversation**

In `athena-panel-provider.tsx`:

- Remove from `AthenaPanelValue`, the provider body, and the memo: `selectedId`, `selected`, `queue`, `detailPending`, `detailError`, `feedback`, `pending`, `createPending`, `selectSession`, `sendMessage`, `lifecycle`, `decide`, `create`, along with `useAthenaActions`, `personalAthenaQueueDef`, `personalAthenaDetailDef`, `groupAthenaQueue`, `AthenaWorkbench`, `AthenaContextChip`, `MentionTextarea`, `useMentionOrgId`, `Skeleton`, `surfaceToneColor`, `cn`, `Link`, `athenaHref`, and the `PersonalAthenaSessionDetail`/`Summary`/`QueuePayload` types if unused.
- The page-follow effect becomes: `useEffect(() => { if (launchDraft !== null) return; setContext(pageContext); }, [launchDraft, pageContext]);` — there is no selection any more. Keep `openAthena`, `closeAthena`, the shortcut, `railStatus`, `railContent`.
- `AthenaRailPanel`:

```tsx
export function AthenaRailPanel(): JSX.Element {
  const { railContent, context } = useAthenaPanel();
  const orgId = context?.workspaceId;
  return (
    <Surface
      as="section"
      tone="page"
      shape="none"
      className="flex h-full min-h-0 flex-col"
      aria-label="Athena"
    >
      {railContent ??
        (orgId ? <AthenaRailConversation orgId={orgId} /> : <AthenaRailNoWorkspace />)}
    </Surface>
  );
}

/** The rail before a workspace is known. One line; the shell resolves one on every work route. */
function AthenaRailNoWorkspace(): JSX.Element {
  return (
    <p role="status" className="text-on-surface-variant text-body-medium p-4">
      Open a workspace to talk to Athena.
    </p>
  );
}
```

Import `AthenaRailConversation` from `./athena-rail-conversation`. Watch for a circular import: `athena-rail-conversation.tsx` imports `useAthenaPanel` from the provider, and the provider imports the rail body. ES modules tolerate this because both are used at render time, not module-evaluation time; if Vitest or Next complains, move `AthenaRailPanel` and `AthenaRailNoWorkspace` into `athena-rail-conversation.tsx` and re-export `AthenaRailPanel` from the provider file for the shell's existing import.

- Delete `AthenaRailQueue` and `AthenaRailComposer`.
- Update the provider's docblock: the rail shows the conversation; `/athena` keeps the queue until Phase 2.

Also update `apps/web/src/app/(app)/today/page.tsx`, `today-prompt.tsx`, `calendar-item-workspace.tsx`, `athena-context-action.tsx` only if they referenced a removed member (they use `openAthena` only; confirm with grep).

- [ ] **Step 6: Run `tests/athena`, `tests/components/app-shell-frame.test.tsx`, `tests/plan-canvas` (or wherever the plan conversation is tested: grep for `PlanRailConversation`), eslint on changed files, `pnpm typecheck`. Expect PASS. Commit**

```
feat(athena): Open the conversation when Athena opens

The rail's Athena panel is now the person's conversation on every work page: the mark, Talk, a
way to the wide view, the thread, and the composer with the page chip above it. The job list, the
"Start this work" form, Back, and the counts leave the rail; the wide view keeps them until
delegated work lands in the thread. A plan's conversation is the same panel with its own opening
line.

Docs-impact: Updated - docs/superpowers/specs/2026-09-12-athena-companion-design.md
Co-authored-by: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 6: Athena first in the rail

**Files:**

- Modify: `apps/web/src/components/app-shell-frame.tsx` (`railAsideFor`, ~line 530)
- Test: `apps/web/tests/components/app-shell-frame.test.tsx`

**Interfaces:** `railAsideFor(identityUnknown, timerStatus, athena: RailPanel)` returns `{ panels: [athena, agenda, focus], defaultPanelId: athena.status?.tone === 'attention' ? 'athena' : 'agenda' }`.

- [ ] **Step 1: Failing test**

Find how the existing test renders the shell with a resolved session (the `describe('AppShellFrame session loading')` block's helpers) and add:

```tsx
it('puts Athena first in the rail', async () => {
  renderResolvedShell();
  const bar = await screen.findByRole('toolbar', { name: /panels/i });
  const buttons = within(bar).getAllByRole('button');
  expect(buttons[0]).toHaveAccessibleName(/Athena/);
});
```

If the activity bar is not a `toolbar`, read `packages/ui/src/components/shell/ShellActivityBar.tsx` for its landmark role and name and query that.

- [ ] **Step 2: Implement**

```ts
return {
  panels: [athena, agenda, focus],
  defaultPanelId: athena.status?.tone === 'attention' ? 'athena' : 'agenda',
};
```

Update the function's TSDoc: Athena leads; the rail opens on Athena when the thread needs the person.

- [ ] **Step 3: Run the shell test file, eslint, typecheck. Commit**

```
feat(athena): Put Athena first in the rail and open there when something needs you

The rail's panels now lead with Athena, ahead of Agenda and Focus, and a fresh window opens on
Athena when a proposal or question is waiting; a quiet day still opens on the Agenda.

Docs-impact: Updated - docs/superpowers/specs/2026-09-12-athena-companion-design.md
Co-authored-by: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 7: Browser journeys and screenshots

**Files:**

- Modify: `apps/web/e2e/athena/athena-personal.spec.ts`, `apps/web/e2e/athena/companion-context.spec.ts`

- [ ] **Step 1: Update `athena-personal.spec.ts`**

Replace the desktop-rail assertions (the queue button, Back, the heading) with:

```ts
const desktopRail = page.getByRole('complementary', { name: 'Athena' });
await expect(desktopRail).toBeVisible();
await expect(desktopRail.getByRole('form', { name: /Message Athena/ })).toBeVisible();
await expect(desktopRail.getByRole('link', { name: /Open the Athena page/ })).toBeVisible();
```

Add to the route fixture a handler for `GET /v1/orgs/<orgId>/sessions/chat` returning an empty completed thread (same shape as the unit tests' `thread()`), and for `POST /v1/me/athena/chat/messages` returning it too. Keep the mobile and Calendar halves.

- [ ] **Step 2: Update `companion-context.spec.ts`**

The journey now proves the composer draft and chip survive navigation: on `/today` press ⌘J, type into the textarea labelled "Message Athena", click the Home nav's Inbox link, assert the textarea still has the text. Then navigate to a seeded project page (create one through the API with the cookie from the sign-up helper; see `docs/engineering/ui-verification.md` for the seeding pattern) and assert `getByRole('group', { name: /<project name>/ })` is visible inside the rail. Keep the fixture for `/v1/me/athena/pulse` and add the chat handlers from Step 1.

- [ ] **Step 3: Run both specs against the stack**

Per `docs/engineering/ui-verification.md`, with `DOCKET_DEV_PORT=1375`. Expected: 2 passed. Then `pnpm db:reset` and stop the stack.

- [ ] **Step 4: Capture the shot set**

With the stack still up and a seeded account (project "Fall fundraiser launch" with two tasks, one message already sent so the thread is populated), capture at 1440×900 and 390×844, light and dark, via `apps/web/e2e/tools/capture-shots.ts` into `apps/web/.data/design-review/2026-09-18-phase1/`: `/today` with ⌘J open; the project page with the rail open and a suggestion visible (send nothing first for this one); the task page after a message was sent. Report scrollWidth ≤ clientWidth on each. These files are for the controller to send to the person; do not commit them.

- [ ] **Step 5: Commit the spec changes**

```
feat(athena): Prove the rail opens the conversation and keeps its draft across pages

The browser journeys now expect the conversation in the rail on every work page, with the way to
the wide view in its header, and prove a half-typed message and the attached page survive moving
between pages.

Docs-impact: Not needed - tests only
Co-authored-by: Claude Fable 5.1 <noreply@anthropic.com>
```

---

### Task 8: Gates and the work log

- [ ] Run root `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` (force the web package if turbo replays: `pnpm exec turbo run test:coverage --filter=@docket/web --force`).
- [ ] In `docs/WORKLOG.md` under `[ATHENA-COMPANION-001]`: tick Phase 1; add a Notes bullet: `**Phase 1 landed (<date>)**: the rail's Athena panel is the conversation on every work page, with the page chip and suggestions; the job list left the rail and stays on /athena until Phase 2. ⌘J on a page with a source opens the conversation with that page attached (decision recorded).` Bump the header date.
- [ ] Commit: `chore(athena): Record the companion's Phase 1 in the work log` with a ≥100-char body and the co-author trailer.
- [ ] `git fetch origin main && git rev-list --merges --count origin/main..HEAD` must print 0. Do not push.
