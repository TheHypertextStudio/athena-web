# The Ghost Grammar

> **Status**: Shipped with the Athena agent (2026-07-03)
> **Companions**: `docs/engineering/specs/athena-agent.md` §7 (the projection contract),
> `docs/core/mvp-plan.md` §8.6 (sessions-first), the craft rubric's no-view-swap gate

Athena's signature visual system: **a proposal is a translucent version of the real thing,
in the real place, that solidifies when you bless it.** One grammar everywhere — the
session's batch card, Today's "Proposed by Athena" lane, the chat thread's in-line review —
so "not real yet" is always read the same way at a glance.

## Why it exists

"Suggestions are not tasks" is a product invariant (email-to-task §2.3). The ghost grammar
makes the invariant _visible_: nothing Athena proposes can be mistaken for committed work,
and reviewing feels like arranging your own workspace rather than auditing a diff. It also
gives approval physical continuity — the thing you approved is the thing that appears,
in the place you approved it.

## The rules

1. **Real components, ghost treatment.** A ghost renders with the same component family as
   the real entity (task row silhouette, same type scale) at reduced opacity (`~60–80%`),
   with a **dashed `primary`-tinted border** and a small uppercase **`proposed` badge**.
   Never a skeleton, never a grayed disabled state — a ghost is interactive.
2. **Editable until blessed.** Click a ghost's title to edit it in place. Edits PATCH the
   stored tool input; **approval executes exactly what is shown**. After a decision the
   ghost is immutable (the API 409s).
3. **Solidify in place.** Every ghost carries a stable `view-transition-name`
   (`proposal-<activityId>`). Approval must morph the ghost into the real row where it
   stands — opacity up, dashed border → solid, badge fades. No view swaps, nothing
   teleports (the shared-element rule).
4. **Batches review as one unit.** Ghosts group by `proposalGroupId` (one assistant turn's
   related creations). The group surface always offers **Approve all N / Approve selected /
   Reject all** — approving forty imported tasks is one gesture, not forty.
5. **Ghosts are for approvers only.** Pending proposals never render for teammates who
   cannot decide them; Athena's homework isn't visible until it's real.
6. **Quiet by default.** A ghost lane that has nothing to show renders nothing — no empty
   states, no badges, no reminders. The grammar whispers.
7. **Spatial home or session card.** Proposals with a workspace shape (a `create_task`
   ghost) live in the views they would land in; anything without one (a description
   rewrite) reviews as a proposal card in the session work log. The session card is always
   the narrative summary + "review all N" entry; the workspace is where the yes happens.

## Current surfaces

| Surface               | File                                                     |
| --------------------- | -------------------------------------------------------- |
| Session batch card    | `apps/web/src/components/agents/proposal-group-card.tsx` |
| Today's ghost lane    | `apps/web/src/components/today/ghost-proposals.tsx`      |
| Chat in-thread review | `apps/web/src/app/(app)/orgs/[orgId]/athena/page.tsx`    |

The projection they render is `GET /v1/orgs/:orgId/sessions/:id/proposals`
(`ProposalGroupOut` → `ProposalItemOut` → `GhostTaskOut`); edits go through
`PATCH …/activity/:activityId/proposal`.

## Extending the grammar

New proposal kinds earn a ghost by adding a projection in
`apps/api/src/agent/proposals.ts` (`projectGhost`) and a ghost render state for the
matching real component. Follow rule 7: if the entity has a place, ghost it there;
otherwise let the session card carry it. An edit surface is part of the deal — a ghost you
cannot fix before blessing forces reject-and-retry loops, which is the experience this
grammar exists to prevent.
