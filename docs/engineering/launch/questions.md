# Question register

**GEN-08** — "The launch run reaches production sign-off with zero requests to the author for approval
on tooling choice, auth workarounds, credentials, or production deploys. Every question actually asked
is recorded in the launch record with three things: the requirement ID it blocked, the two or more
product outcomes that were each defensible, and why neither could be selected from the plan text. The
number of questions failing to record all three is zero."

---

## Tally

- **Approval requests made to the author (tooling choice, auth workarounds, credentials, production
  deploys): 0.**
- **Questions asked interactively during this launch run: 0.**
- **Questions raised in writing for the author to answer: 1** (Q-01 below, fully formatted).
- **Entries failing to record all three required fields: 0.**

---

## The required format

Every entry, without exception, records these three fields. An entry missing any one of them is a
malformed entry and counts against GEN-08.

```markdown
### Q-nn — <one-line question>

- **Blocks:** <requirement id(s)> — the work that cannot proceed until this is answered.
- **Defensible outcomes:** at least two, each stated as a product outcome a reasonable person
  would ship, not as a menu of implementation details.
  1. **<Outcome A>** — what the user ends up with, and who it is right for.
  2. **<Outcome B>** — what the user ends up with, and who it is right for.
- **Why the plan text cannot choose:** the specific gap — quote the plan sentence and say what it
  leaves open. "The plan doesn't mention it" is only sufficient when the requirement itself
  presupposes the missing fact.
- **Status:** RAISED (awaiting answer) | ANSWERED (with the answer and its date)
```

Two rules about what does **not** belong here:

1. **Approval requests are not questions.** "May I use the CLI instead of the MCP server?", "May I
   deploy?", "May I authorize this account?" are all pre-authorized by the plan and were therefore
   never asked. Where an obstacle needed routing around, it was routed around and recorded in
   `obstacle-log.md` with the session actually used.
2. **A decision with one defensible outcome is not a question.** If reading the plan and the codebase
   yields a single answer a reviewer would accept, that is a decision to make and document, not a
   question to raise. The decisions resolved that way during this run are listed at the bottom.

---

## Entries

### Q-01 — Which vendor is "Lovelace Lattice"?

- **Blocks:** WIL-41, WIL-42, WIL-43, WIL-44, WIL-45, WIL-46, WIL-47, WIL-48, WIL-49 — the entire
  Lattice integration family, including two launch-blockers (WIL-41 end-to-end flow, WIL-47 OAuth
  authorization).
- **Defensible outcomes:** the requirement text supports at least two materially different products,
  and they lead to different architectures:
  1. **A local-inference gateway** — "Lattice" is a hosted gateway that brokers Athena's model calls
     to models running on the _user's own device_. This reading follows WIL-41 ("models running on
     that device power Athena's work") and WIL-49 ("Athena's requests go to Lattice's gateway and are
     routed through it to the user's locally running device"). Shipping this means a model-provider
     adapter behind Docket's existing provider seam, plus an OAuth connection managed in Settings.
     Right for a user who wants their own hardware doing the inference.
  2. **An agent-platform / skill host** — "Lattice" is an agent runtime whose _skills_ Athena
     installs and invokes. This reading follows WIL-43 ("the appropriate Lattice skill is found,
     installed, and used to build the integration"), which reads oddly under (1): a pure inference
     gateway does not have "skills" to install. Shipping this means a capability/tool integration,
     not a model-backend swap — a different surface, a different OAuth scope set (WIL-48), and a
     different failure mode when the device is offline.
- **Why the plan text cannot choose:** the plan names the product but never identifies the vendor, and
  every independent probe for its identity came back empty — repo grep (only the audit baseline
  mentions it), dependency probe (`grep -ci lattice pnpm-lock.yaml` → `0`), three DNS lookups (all
  `NXDOMAIN`), and a live web search that returned three unrelated products also called Lattice
  (`lattice.com` HR, `lattice.inc`, Anduril's Lattice). Full output in `external-systems.md` §
  Lovelace Lattice. WIL-42 requires building "on the Lovelace Lattice SDK rather than a hand-rolled
  client" and WIL-46 requires the connection to be turnkey with "no hand-entered endpoints/keys" —
  both of which presuppose a specific, named SDK and issuer. Guessing the vendor would violate WIL-42
  by construction. **The single input needed is the SDK package name or the OAuth issuer URL.**
- **Status:** RAISED. Raised in writing here rather than asked interactively — this worker runs
  non-interactively and per the plan must not interrupt the author mid-run. WIL-51 already sequences
  the Lattice work strictly after the Cloudflare model-router path (WIL-50) is proven, so no other
  requirement is waiting on the answer.

---

## Decisions made without asking

Recorded here so the absence of questions is legible as _decisions taken_, not as work skipped. Each
of these could have been an interruption; none of them needed to be.

| Decision                                                                            | Resolved by                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Vercel MCP server unavailable — use a different transport?                          | The plan pre-authorizes any CLI or account. Used the already-authorized `vercel` CLI. `obstacle-log.md` OBS-01.                                                                                        |
| `npx wrangler` would not install — abandon the Cloudflare check?                    | The repo already depends on wrangler via `apps/runner`; used the workspace binary. OBS-02.                                                                                                             |
| Docker unavailable — wait for it?                                                   | No. Used the repo's embedded-PGlite dev stack (`./scripts/dev-stack.sh`). OBS-03.                                                                                                                      |
| MISS-07 asks for a "landed commit", but this lane may not commit.                   | Made slice files the canonical record and said so explicitly in `README.md`; kept the half that does not depend on commits enforced exactly (`git rev-list --merges --count origin/main..HEAD` → `0`). |
| GEN-01 counts `deferred / partial / TODO / blocked`; what about `fail`/`not-built`? | Counted a strict superset — every non-`pass` disposition plus unclaimed. A looser predicate would manufacture a green sign-off, which is the exact failure GEN-01 exists to prevent.                   |
| Should the sign-off gate be made to pass today?                                     | No. It exits non-zero and names every open id. `scripts/launch-record.ts --sign-off`.                                                                                                                  |
| Which YAML parser for slice frontmatter?                                            | None — a strict in-repo parser, because adding a dependency for a fixed six-key shape is worse than 90 lines that _reject_ anything off-contract.                                                      |
