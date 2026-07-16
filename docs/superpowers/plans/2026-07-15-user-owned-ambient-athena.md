# User-Owned Ambient Athena Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> task-by-task. Every behavior change follows red-green-refactor and every completed task receives
> spec-compliance and code-quality review.

**Goal:** Make Athena a private, user-owned assistant that acts with exactly the requesting user's
current permissions, then replace the generic chat UI with an ambient dock and full personal
operations workspace.

**Architecture:** Extend the durable session substrate with an Athena executor owned by a Better
Auth user. Run Athena's in-process MCP client as that user principal so each tool resolves current
workspace permissions. Add personal session APIs and connections, then adapt all Athena surfaces to
one dense workbench while retaining registered agents as a separate workspace-scoped executor.

**Tech Stack:** Hono, Better Auth, Drizzle/Postgres, MCP SDK, Cloudflare Queues/Workflows, Next.js
App Router, TanStack Query, Tailwind CSS, Vitest, Testing Library, Playwright.

## Global constraints

- Athena never receives a workspace Actor, grant, role, or independent authorization path.
- Personal work is owner-only; shared results retain ordinary resource visibility.
- Approval re-authorizes the stored tool call as the current user.
- Existing unrelated working-tree changes remain untouched.
- User-facing language says workspace, work, and Athena—not company or generic session management.
- Every implementation slice is committed atomically with a substantive Conventional Commit body.

---

### Task 1: User-owned execution contracts and fresh schema

- [x] Write failing type and schema tests for executor discrimination, owner fields, optional context,
      activity attribution, transcript/run ownership, and database constraints.
- [x] Add the Drizzle migration and update all session creation/read helpers without changing runtime
      authorization yet.
- [x] Require existing databases to be reset. Keep the migration free of ownership inference and
      verify the complete migration chain creates the fresh executor schema.
- [x] Run focused type/database tests and commit the green slice.

### Task 2: User-principal toolbox and authorization

- [x] Write failing MCP/loop tests proving Athena uses the owner's current Actor, creates no default
      agent/grant, loses access immediately after revocation, and gains access without reprovisioning.
- [x] Add an internal user MCP context and make Athena's toolbox load it from `ownerUserId`.
- [x] Update the loop, approved-action executor, runner, audit metadata, prompt, and concurrency owner.
- [x] Keep the registered-agent path unchanged and cover both executor kinds.
- [x] Run focused MCP/agent tests and commit the green slice.

### Task 3: Personal Athena APIs, privacy, and steering

- [ ] Write failing route tests for owner-only list/detail/chat/stream/lifecycle/approval access and
      cross-workspace invocation context.
- [ ] Add `/v1/me/athena` chat, work, session, message, proposal, approval, lifecycle, and SSE routes.
- [ ] Make approval owner-scoped and rely on underlying tool authorization instead of unrelated
      `assign` permission.
- [ ] Preserve organization session routes for registered agents and temporary route compatibility.
- [ ] Run focused API tests and commit the green slice.

### Task 4: Personal MCP connections and delegation

- [ ] Write failing tests proving personal connectors are reusable across the owner's workspaces and
      invisible to other users.
- [ ] Add user ownership for new Athena MCP connections; existing database credentials are discarded
      by the required reset and users reconnect their personal services.
- [ ] Load remote tools by session owner and keep operational workspace integrations separate.
- [ ] Add user-owned Athena assignments for initiatives, projects, and tasks; recheck access on each
      triggered run and pause assignments after access loss.
- [ ] Run focused integration/assignment tests and commit the green slice.

### Task 5: Personal Athena presentation model and workbench

- [ ] Write failing presenter/component tests for queue grouping, owner-only data, state language,
      structured tool rows, approvals, results, and hidden raw reasoning.
- [ ] Add typed TanStack Query definitions and pure presentation adapters.
- [ ] Build the shared dense workbench: objective, needs-you lane, progress log, tool activity,
      proposals, receipt, lifecycle controls, and state-aware command input.
- [ ] Reuse the workbench on personal session deep links and commit the green slice.

### Task 6: Ambient dock and full Athena workspace

- [ ] Write failing shell/route tests for global `Cmd/Ctrl+J`, invocation context, personal counts,
      dock expansion, `/athena`, and legacy redirects.
- [ ] Replace `AthenaConversation` with the contextual dock and add the compact shell pulse.
- [ ] Build `/athena` as a responsive queue/workbench/context composition.
- [ ] Remove Athena and Agents from workspace navigation; move personal controls to global Settings.
- [ ] Run focused web tests and commit the green slice.

### Task 7: Ambient entry points and real-browser validation

- [ ] Write failing interaction tests for Today, task, project, initiative, Stream, Calendar, and Inbox
      invocations.
- [ ] Wire each surface through the shared `openAthena` contract without creating local mini-chat UIs.
- [ ] Add Playwright coverage for personal privacy, contextual handoff, approval, Sunsama tool calls,
      dock expansion, and redirects.
- [ ] Capture the actual authenticated app at desktop/mobile widths in light/dark themes and run the
      Docket design review.
- [ ] Resolve visual, wrapping, focus, touch-target, and accessibility findings.

### Task 8: Documentation, verification, and linear closeout

- [ ] Update Athena product, engineering, permissions, MCP, API, and data-layer documentation.
- [ ] Run focused suites, `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`.
- [ ] Verify the schema migration on a fresh database and the relevant Playwright journeys.
- [ ] Complete the WORKLOG retrospective and final code review.
- [ ] Rebase onto current local `main`, verify zero merge commits, and present the branch integration
      choices required by the finishing-a-development-branch workflow.
