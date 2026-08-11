# Stream Context Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Stream as the chronological history of its current context, with adjacent events
grouped into inline entity episodes, substantive changes preserved, compact identity language, and
verified production deployment.

**Architecture:** Keep `event` as the durable source of truth and add viewer-relative identity only
to the Stream read projection. The API returns membership-scoped raw events in strict keyset order;
the client performs a pure, conservative episode projection over loaded pages and buffers new
first-page events until the reader reveals them. The UI renders semantic date sections,
subject-led episodes, substantive event lines, and an expandable audit trail for minor activity.

**Tech Stack:** TypeScript, Zod, Hono, Drizzle ORM, React 19, Next.js App Router, TanStack Query,
Tailwind/MD3 tokens, Vitest, Testing Library, Playwright, GitHub Actions, Vercel, GCP Cloud Run.

---

### Task 1: Extend the contract with viewer-relative identity

**Files:**

- Modify: `packages/types/src/stream.ts`
- Modify: `packages/types/tests/dto/stream.test.ts`
- Modify: `apps/api/src/routes/stream-helpers.ts`
- Modify: `apps/api/src/routes/stream.ts`
- Modify: `apps/api/src/routes/hub.ts`
- Modify: `apps/api/tests/routes/stream-read.test.ts`

- [ ] **Step 1: Write failing DTO tests**

Add `actorIsViewer: false` to the valid fixture, then assert an omitted or non-boolean value fails.

```bash
pnpm --filter @docket/types test tests/dto/stream.test.ts
```

Expected: FAIL because `StreamEventOut` does not declare the field.

- [ ] **Step 2: Add the required projection field**

```ts
export const StreamEventOut = EventOut.omit({ userId: true, externalId: true }).extend({
  actorIsViewer: z.boolean(),
  relevance: StreamRelevance.nullable(),
  rendering: StreamRendering,
});
```

Run the DTO test. Expected: PASS.

- [ ] **Step 3: Write failing route tests**

Seed a human Actor, one event whose `actor.docketActorId` matches it, and one whose actor does not.
Assert the workspace route returns `[true, false]`; add equivalent Hub coverage.

```bash
pnpm --filter @docket/api test tests/routes/stream-read.test.ts
```

Expected: FAIL because the serializer omits viewer identity.

- [ ] **Step 4: Make the serializer viewer-aware**

```ts
export function toStreamEventOut(
  row: EventRow,
  relevance: StreamRelevance | null,
  viewerActorIds: ReadonlySet<string> = new Set(),
): z.input<typeof StreamEventOut> {
  return {
    // existing projection
    actorIsViewer: Boolean(row.actor?.docketActorId && viewerActorIds.has(row.actor.docketActorId)),
  };
}
```

Pass `new Set([actorId])` from the workspace route and the caller's active Actor ids from Hub. Run
the DTO and route tests. Expected: PASS.

- [ ] **Step 5: Commit**

Commit only this slice as `feat(web): Give Stream viewer-relative actor identity` with a substantive
body.

### Task 2: Make Hub Stream context-wide

**Files:**

- Modify: `apps/api/src/routes/hub.ts`
- Modify: `apps/api/src/routes/hub-helpers.ts`
- Modify: `apps/api/tests/routes/stream-read.test.ts`

- [ ] **Step 1: Replace recipient-curated expectations with failing context tests**

Prove a member sees an event without an `eventRecipient` row, relevance is null, a recipient row in
an inaccessible workspace cannot leak, and equal-timestamp cursor ordering remains stable.

```ts
expect(titles).toEqual(['Member event', 'Recipient event']);
expect(body.items.every((item) => item.relevance === null)).toBe(true);
expect(body.items.some((item) => item.title === 'Foreign event')).toBe(false);
```

Run the API Stream test. Expected: FAIL while Hub joins `event_recipient`.

- [ ] **Step 2: Query `event` through active workspace membership**

Use `callerOrgIds` and `callerActorIds`; select directly from `event`; filter with
`inArray(event.organizationId, orgIds)`; use event columns for filter, cursor, and sort; project null
relevance and viewer Actor ids. Remove `eventRecipient` from this route and update OpenAPI prose.

- [ ] **Step 3: Validate and commit**

```bash
pnpm --filter @docket/api test tests/routes/stream-read.test.ts
pnpm --filter @docket/api typecheck
```

Expected: PASS. Commit as `feat(hub): Make Stream reflect the full current context`.

### Task 3: Build the pure episode projection

**Files:**

- Replace: `apps/web/src/components/stream/stream-grouping.ts`
- Replace: `apps/web/tests/components/stream/stream-grouping.test.ts`
- Modify: `apps/web/src/components/stream/stream-meta.ts`
- Modify: `apps/web/tests/components/stream/stream-meta.test.ts`

- [ ] **Step 1: Write failing boundary tests**

```ts
expect(buildStreamGroups([sameA, sameAOlder], NOW)[0]!.episodes).toHaveLength(1);
expect(buildStreamGroups([a, b, aOlder], NOW)[0]!.episodes).toHaveLength(3);
expect(buildStreamGroups([a, aThreeHoursOlder], NOW)[0]!.episodes).toHaveLength(2);
expect(buildStreamGroups([beforeMidnight, afterMidnight], NOW)).toHaveLength(2);
```

Run the grouping test. Expected: FAIL because only date buckets exist.

- [ ] **Step 2: Implement subject keys and episode boundaries**

Add `StreamEpisode` and `StreamDateGroup`. Group only consecutive equal subject keys in one date
bucket with no adjacent gap over two hours. Key by `docketEntityId`, then
source/entity-kind/external-id, then event id. Preserve server order.

- [ ] **Step 3: Write failing meaning/compression tests**

Cover visible completion/comment/status/assignment/agent outcomes; collapsible reactions, timers,
agent progress, and cosmetic field changes; minor-only episodes; unknown details; and identical
five-minute repeats. Assert `allEvents` always retains each canonical row.

- [ ] **Step 4: Implement classification and fingerprints**

```ts
export function isSubstantiveStreamEvent(row: StreamEventRow): boolean;
export function streamEventFingerprint(row: StreamEventRow): string;
export function buildStreamGroups(rows: readonly StreamEventRow[], now: Date): StreamDateGroup[];
```

Unknown kinds/details return substantive. Duplicate folding changes presentation arrays only.

- [ ] **Step 5: Add self-aware copy tests and helpers**

Retain `actorIsViewer` in `toRow`; implement `streamActorLabel`, `streamEventSentence`, and
`streamEventDetailLabel`. Use `You` only from the explicit flag and never parse display names.

- [ ] **Step 6: Validate and commit**

```bash
pnpm --filter @docket/web test tests/components/stream/stream-grouping.test.ts tests/components/stream/stream-meta.test.ts
```

Expected: PASS. Commit as `feat(web): Group Stream events into meaningful episodes`.

### Task 4: Buffer new events without moving the reader

**Files:**

- Create: `apps/web/src/components/stream/stream-snapshot.ts`
- Create: `apps/web/tests/components/stream/stream-snapshot.test.ts`
- Modify: `apps/web/src/components/stream/use-stream-page.ts`
- Modify: `apps/web/src/components/stream/stream-view.tsx`

- [ ] **Step 1: Write failing snapshot tests**

Exercise initial load, a new prefix, an older pagination suffix, repeated polling, query-key reset,
and reveal behavior against:

```ts
interface StreamSnapshot {
  readonly visible: readonly StreamEventRow[];
  readonly pending: readonly StreamEventRow[];
}
```

- [ ] **Step 2: Implement the pure merge**

Keep a fetched prefix before the current first id pending; append new older ids directly to visible;
deduplicate by id; reset when the query key changes. Reveal returns current fetched server order and
no pending events.

- [ ] **Step 3: Wire `useStreamPage` and the control**

Expose `events`, `newEventCount`, and `onShowNewEvents`. Render a focus-preserving `N new events`
button and polite live region; never buffer initial load or older-page appends.

- [ ] **Step 4: Validate and commit**

```bash
pnpm --filter @docket/web test tests/components/stream/stream-snapshot.test.ts
pnpm --filter @docket/web typecheck
```

Expected: PASS. Commit as `feat(web): Preserve Stream reading position during updates`.

### Task 5: Render the inline subject-led timeline

**Files:**

- Create: `apps/web/src/components/stream/stream-episode.tsx`
- Create: `apps/web/src/components/stream/stream-event-line.tsx`
- Create: `apps/web/tests/components/stream/stream-episode.test.tsx`
- Modify: `apps/web/src/components/stream/stream-view.tsx`
- Modify: `apps/web/src/components/stream/stream-event-detail.tsx`
- Modify: `apps/web/src/components/stream/event-drawer.tsx`
- Modify: `apps/web/src/components/stream/stream-catalog.ts`
- Delete: `apps/web/src/components/stream/stream-event-row.tsx`
- Delete: `apps/web/tests/components/stream/stream-event-row.test.tsx`

- [ ] **Step 1: Write failing component tests**

Assert the subject renders once, substantive lines remain separate, viewer copy says `You`, Docket
attribution is absent, an external source and Hub workspace appear once, and related events disclose
the complete audit list with `aria-expanded`.

- [ ] **Step 2: Implement the event line and episode ledger**

Use a 40px-minimum focusable line with sentence, typed detail, and relative time. Use a two-column
entity-icon/content grid, separate subject link and event buttons, hairlines instead of cards, and a
collapsed related-event disclosure. Keep semantic tokens and MD3 text roles only.

- [ ] **Step 3: Complete typed detail rendering**

Handle `docket.field_change`, `docket.timer`, and agent milestones. Render stored labels and
before/after values, never field keys, provider exception text, or raw errors.

- [ ] **Step 4: Make Stream filter-only and context-accurate**

Remove Stream catalog grouping/sorting flags so the shared toolbar exposes only Filter. Use the
approved workspace/Hub subtitles. Provide a working Clear filters action in filtered-empty state.

- [ ] **Step 5: Update the drawer and remove old row chrome**

Use viewer-aware copy in the drawer; keep exact time, complete detail, source, and Athena context.
Remove actor-avatar anchoring, metadata duplication, and repeated hover action clusters.

- [ ] **Step 6: Validate and commit**

```bash
pnpm --filter @docket/web test tests/components/stream
pnpm --filter @docket/web typecheck
pnpm --filter @docket/web lint
```

Expected: PASS. Commit as `feat(web): Render Stream as an inline context timeline`.

### Task 6: Prove craft, accessibility, and responsive behavior

**Files:**

- Create or modify: `apps/web/e2e/stream.spec.ts`
- Create: `docs/design/audits/2026-08-10-stream.md`
- Modify: Stream components as findings require

- [ ] **Step 1: Add and run an end-to-end Stream journey**

Seed repeated edits, a substantive change, an external event, and a self-authored event. Assert the
route loads, self copy is `You`, related activity expands, the subject opens, filters are keyboard
operable, and duplicate full-name metadata is absent.

```bash
pnpm --filter @docket/web exec playwright test e2e/stream.spec.ts
```

- [ ] **Step 2: Run the Docket Craft Rubric shot set**

Capture 1440×900 and 390×844 in light/dark, plus loading, filtered-empty, long-title overflow, and
320px overflow evidence. Keyboard-tab the primary flow and write the eight-dimension scorecard.

- [ ] **Step 3: Fix findings test-first and re-score**

Add a failing behavior test before each product-code correction. Repeat until all dimensions are at
least 3 and all hard gates pass.

- [ ] **Step 4: Commit**

Commit as `feat(design): Bring Stream to the Docket craft bar`.

### Task 7: Validate and document the release

**Files:**

- Modify: `docs/WORKLOG.md`
- Modify: `docs/superpowers/plans/2026-08-10-stream-context-timeline.md`

- [ ] **Step 1: Run repository gates**

```bash
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

Expected: all PASS. Production cannot proceed on a known current-main gate failure; diagnose or
repair the authoritative failure rather than narrowing the completion claim.

- [ ] **Step 2: Complete work tracking**

Move `STREAM-UX-002` to Completed with exact files, test counts, screenshots, scorecard verdict, and
learnings. Mark each executed plan checkbox complete with no placeholders or skipped steps.

- [ ] **Step 3: Commit closeout documentation**

Commit as `chore(web): Close out the Stream timeline release`.

### Task 8: Land linearly and verify production

**Files:** None unless a deployment repair is required.

- [ ] **Step 1: Rebase onto live main and repeat affected gates**

```bash
git fetch origin --prune
git rebase origin/main
git rev-list --merges --count origin/main..HEAD
```

Expected: merge count `0`; root gates and the focused Stream journey pass on the exact release SHA.

- [ ] **Step 2: Fast-forward and push main**

From the clean primary checkout, confirm `main` still equals `origin/main`, then run
`git merge --ff-only codex/stream-context-timeline-design` and `git push origin main`.

- [ ] **Step 3: Follow exact-SHA CI and E2E**

Use `gh run list --branch main` to identify the pushed SHA's CI and E2E runs. Watch them to
completion; inspect the newest failing job and land a validated linear follow-up if either fails.

- [ ] **Step 4: Verify every production layer**

```bash
curl --fail --silent --show-error https://docket-api.hypertext.studio/v1/health
curl --fail --silent --show-error --head https://docket.hypertext.studio/stream
curl --fail --silent --show-error --head https://docket-admin.hypertext.studio
```

Confirm the deploy job succeeded for the pushed SHA, Vercel production uses that SHA, and an
authenticated production browser shows inline episodes, `You`, external attribution, disclosure
behavior, theme parity, and zero console errors.

- [ ] **Step 5: Complete the active goal**

Record the release SHA and workflow/deployment evidence. Call `update_goal(status: "complete")` only
after the redesign is live and verified.
