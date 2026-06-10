# The Docket Craft Rubric

> **Version**: 1.0.0
> **Last Updated**: 2026-06-09
> **Applies To**: Every user-facing surface — marketing, auth, onboarding, and the app.

This is the canonical framework for evaluating UI in Docket. It exists because "looks fine" is not a standard. Every surface is scored against eight dimensions and checked against five hard gates. The rubric is run by the `/design-review` skill (`.claude/skills/design-review/`), and scorecards live in `docs/design/audits/`.

---

## Brand foundations (what we're measuring against)

Two registers, one product, an honest seam between them:

|           | Marketing surface                                                                    | App surface                                                                                      |
| --------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| **Feel**  | Indie but sophisticated. Paper and ink. Editorial, warm, unhurried.                  | Linear-grade. Calm, dense, fast, keyboard-first.                                                 |
| **Type**  | Fraunces display + IBM Plex Sans body + Plex Mono details                            | IBM Plex Sans + IBM Plex Mono (IDs, timestamps)                                                  |
| **Color** | Cream paper, warm ink, one burnt-sienna accent                                       | 90% neutral MD3 tinted surfaces; color earned by semantics (health, priority, state, org accent) |
| **Never** | Corporate SaaS: purple gradients, glassmorphism, icon-card grids, stock illustration | Developer-tool tells, decoration, cramming, dead placeholder UI                                  |

The **honest seam**: where the two registers meet (product frames on the landing page, the auth pages), the transition is designed and deliberate — the paper hands you the tool. A surface that accidentally mixes registers fails dimension 1.

---

## The four levels

Every dimension is scored 1–4. The levels mean the same thing everywhere:

- **1 — Broken / Generic.** Template-grade. Could be any SaaS. Or actually broken: misaligned, overflowing, contradicting the system.
- **2 — Competent.** Clean, consistent, inoffensive — and forgettable. Nothing is wrong; nothing is authored. This is where most AI-generated UI lands, and it is not the bar.
- **3 — Crafted.** Deliberate decisions are visible. Rhythm, hierarchy, and voice all read as authored by someone who cared. A designer inspecting it finds intent, not accident. **This is the ship bar.**
- **4 — Distinctive.** A moment someone would screenshot. Identity unmistakable — you could crop out the logo and still know it's Docket.

Scores require **evidence**: a specific observation tied to a screenshot ("the section numerals are Plex Mono with hairline rules — authored rhythm" / "three different gap values in one column — leftover spacing"). A score without evidence is a vibe, and vibes don't count.

---

## The eight dimensions

### 1. Brand identity & voice

Does this surface unmistakably read as _Docket_?

- Correct register for the surface (paper/ink editorial vs. calm Plex/MD3) and a designed seam where they meet.
- Copy is specific and confident. Never filler ("Powerful features to help you work smarter"), never developer jargon on a domain-neutral surface.
- One tagline, used consistently: **"Run every organization from one calm place."**
- Vocabulary respects the org's skin (Campaign vs. Initiative) — the UI never leaks internal entity names.

_1:_ interchangeable with any SaaS template. _3:_ register correct, copy authored, seam intentional. _4:_ the surface itself communicates the separation/unification idea without being told.

### 2. Typographic craft

- Uses the **named type scale** (`text-display/h1/h2/h3/body/sm/xs`, `font-mono`) — no ad-hoc sizes or arbitrary `text-[13px]` values without a token-level reason.
- Clear hierarchy: 2–3 levels per view, weight changes carry meaning (600 = structural, 500 = emphasis/labels, 400 = body).
- Prose measure 45–75ch; UI labels never wrap awkwardly; headlines have no orphans at common widths.
- Mono (with tabular feel) for IDs, counts, timestamps — numbers that align.
- Marketing: Fraunces gets optical-size headroom at display sizes; italics reserved for pull-quotes and numerals.

_1:_ raw Tailwind soup, flat hierarchy. _3:_ scale adherence + visible hierarchy logic. _4:_ type alone carries the layout (editorial ledger, pull-quote moments).

### 3. Spatial rhythm & density

- Everything on the **4px grid**; one spacing rhythm per surface — no mixed gap vocabularies (`gap-2` and `gap-[7px]` in the same column is a finding).
- Optical alignment: text baselines, icon boxes, and row edges line up; icons optically centered, not just box-centered.
- Density fits the surface: lists are dense (36px rows at comfortable), marketing is generous, dialogs breathe.
- Whitespace is deliberate — margins frame content rather than being leftover space.

_1:_ inconsistent paddings, crowding, accidental gaps. _3:_ one rhythm, aligned edges, density-appropriate. _4:_ the spacing system is _felt_ — scanning is effortless.

### 4. Hierarchy & information design

The five-second test: what is this page, what's most important, what do I do next?

- **One primary action** per view; secondary actions visually subordinate; destructive actions never primary-styled.
- Progressive disclosure over cramming — never squeeze two screens of intent into one (split steps, drawers, detail panels).
- Grouping and order match user priority, not the data model's column order.
- Empty space ≠ empty meaning: above-the-fold content earns its position.

_1:_ wall of equally-weighted content. _3:_ obvious primary path, subordinate secondaries, sane grouping. _4:_ the page anticipates the next action (smart defaults, focus pre-placed, the right thing already highlighted).

### 5. Color discipline

- **≥90% neutral.** Color is _earned_: health (on/at-risk/off-track), priority, workflow state, agent/session status, one org accent, one marketing accent. Nothing else.
- Semantic tokens only — zero hardcoded hex/oklch in components.
- Both themes are intentional: dark mode designed, not auto-inverted (check tinted surfaces still read as hierarchy in dark).
- Contrast AA minimum for all text and meaningful icons, including on tinted surfaces and the cream marketing palette.

_1:_ decorative color, hardcoded values, broken dark mode. _3:_ token-pure, earned color, both themes verified. _4:_ color so restrained that a single org-accent chip is genuinely informative.

### 6. Motion & feedback

- Every interactive element has hover, active, and focus treatments; disabled states explain themselves (tooltip or adjacent text).
- Transitions use the **motion tokens** (`--dur-fast/base/slow`, `--ease-out/in-out`) — no stock everything-150ms.
- Motion explains spatial relationships: dialogs fade+scale from center, drawers slide from their edge, the org rebind cross-fades. Never decorative.
- `prefers-reduced-motion` fully respected — the app is 100% usable with motion off.
- Feedback within 100ms of any action: optimistic update, spinner, or skeleton matching the final layout.

_1:_ dead hovers, instant pops, no reduced-motion handling. _3:_ tokened, purposeful, respectful. _4:_ motion that teaches the model (the rebind cross-fade making "context switch" legible).

### 7. States completeness

A surface is its worst state, not its happy path.

- **Empty** states teach: what this is, why it's empty, the one action to take next. Never a bare "No items."
- **Loading** uses skeletons that match the final layout (no spinner-only page loads, no layout shift on resolve).
- **Error** states are recoverable: what happened, what to do, retry affordance.
- **Overflow**: long titles truncate with tooltips; large counts abbreviate; many tabs scroll with an overflow menu.
- **Nothing dead**: no read-only "Not set" rows — property rows are functional inline editors. No buttons that no-op.

_1:_ blank screens, dead rows, lorem. _3:_ all states designed, nothing dead. _4:_ empty states that genuinely onboard (live preview, one-click seed action).

### 8. Detail craft (the squint test)

Zoom in to 200%; squint at 50%. Both must hold.

- Pixel alignment of borders, separators, and badges; consistent icon size and stroke weight per context.
- Focus rings use the shared `focusRing` utility — consistent everywhere.
- Correct cursors (`pointer` on links/buttons, `text` on inputs, `default` on rows with their own affordances); correct text selection behavior (none on chrome, normal in content).
- Text never touches container edges; truncation never clips mid-descender.
- **Zero horizontal overflow at any viewport width** (320→1920). Tab bar rules: fixed-width tabs, flexed truncating titles, right-aligned close, no vertical scroll.
- Scrollbars styled; over-scroll backgrounds correct (especially marketing under OS dark mode).

_1:_ misalignments visible without zooming. _3:_ survives the zoom and the squint. _4:_ details that reward inspection (optical corrections, hairline rules that align across sections).

---

## Hard gates (pass / fail)

Any failure blocks ship regardless of dimension scores.

| Gate                    | Standard                                                                                                                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A11y**                | AA contrast; full keyboard operability; visible focus on every interactive element; semantic landmarks and labels; touch targets ≥40px on mobile.                                            |
| **Responsive**          | No horizontal scroll at any width 320→1920; layouts reflow intentionally, not accidentally.                                                                                                  |
| **Theme parity**        | Light AND dark verified by screenshot. (Marketing is intentionally light-only — its gate is "renders correctly when the OS is in dark mode": scrollbars, form controls, over-scroll canvas.) |
| **No placeholder**      | No TODO UI, lorem, dead buttons, or fake data presented as real. Demo/preview data must be labeled as such.                                                                                  |
| **Screenshot-verified** | Every visual claim in a review is backed by a captured screenshot. Unverified = unreviewed.                                                                                                  |

---

## The ship bar

> **Every dimension ≥ 3. Every gate green.**

A 4 somewhere on each major surface is the ambition, not the bar. A surface scoring 2 anywhere goes back to IMPLEMENTING — "competent" is the failure mode this rubric exists to catch.

## Scorecard format

One file per review: `docs/design/audits/YYYY-MM-DD-<surface>.md`.

```markdown
# Design review: <surface> — YYYY-MM-DD

Screenshots: <paths> (1440×900 + 390×844, light + dark)

| Dimension                 | Score | Evidence                                                         |
| ------------------------- | ----- | ---------------------------------------------------------------- |
| 1. Brand identity & voice | 3     | ...                                                              |
| 2. Typographic craft      | 2     | ad-hoc text-[15px] in header; flat weight hierarchy in list rows |
| ...                       |       |                                                                  |

Gates: A11y ✅ · Responsive ✅ · Theme parity ✅ · No placeholder ❌ (dead "Not set" row in properties panel) · Screenshots ✅

## Findings (ordered by severity)

1. <finding> — <file:line> — <proposed fix>

Verdict: BELOW BAR — dimensions 2, 7 and the placeholder gate must be fixed.
```

---

_Changes to this rubric follow the AGENTS.md self-modification protocol: propose with rationale, log in WORKLOG.md, bump the version._
