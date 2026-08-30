---
surfaces: ['orgs-[orgId]-programs']
date: 2026-08-29
verdict: ship
scores:
  brand: 3
  typography: 4
  spacing: 3
  hierarchy: 4
  color: 4
  motion: 3
  states: 3
  detail: 3
gates:
  a11y: true
  responsive: true
  theme-parity: true
  no-placeholder: true
  screenshots: true
---

# Design review: Programs roster (Cards lens) — 2026-08-29

This is the second pass on `/orgs/[orgId]/programs` after the Cards lens became the Program
roster's default. The first pass fixed the card's structure — doubled padding, a card carrying less
than the row it replaced, a histogram drawn without a baseline. This one answers a plainer
objection: the result was correct and still bland, and it said "Unowned" nine times.

Screenshots are in `screenshots/2026-08-29-programs-cards/`: `desktop-{light,dark}` and
`mobile-{light,dark}` are the standard set, plus `loading-light`, `empty-light`, `hover-light`,
`focus-light`, `overflow-long-title-light`, and `w320-light`.

`desktop-light-varied-activity.png` substitutes an eight-week activity window into the work-view
response, because every record in a dev workspace is new and every real window is empty. The
component and its data contract are the shipped ones; only the eight weekly counts stand in.

| Dimension                           | Score | Evidence                                                                                                                                                                                                                                               |
| ----------------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Brand identity and voice         |     3 | Calm MD3 surfaces with one blue status pill and a tinted identity mark. Copy states a condition — "On track · Active yesterday" — rather than labelling fields. Nothing here reads as a generic SaaS card grid.                                        |
| 2. Typographic craft                |     4 | Three registers doing three jobs: `title-large` name, `body-medium` summary, `label-medium`/`label-small` metadata. Before this pass everything under the title sat at 11–12px, which is most of what "bland" meant. No raw type utilities remain.     |
| 3. Spatial rhythm and density       |     3 | One `gap-3` rhythm inside a single `p-4` inset, with the signal and roll-up bands bottom-anchored so they align across a row. `card-styles.ts` holds the inset, minimum height, and grid so the frame and skeleton cannot disagree again.              |
| 4. Hierarchy and information design |     4 | Health is now the largest coloured thing on the card, so "which of these needs me?" is answered at a squint before a word is read — see the green/brown/red/neutral column in `desktop-light.png`. Name, summary, signal, roll-up, in that order.      |
| 5. Colour discipline                |     4 | Health is the only earned colour, spent twice on the same fact (the mark's tint and its label) rather than on two different facts. The histogram dropped from `primary/45` to `outline`; nothing decorative is coloured.                               |
| 6. Motion and feedback              |     3 | Hover moves the card one full step up the surface ramp with the roll-up container moving with it (`hover-light.png`); focus draws the shared ring on the card's own radius (`focus-light.png`). Both are colour-only — no geometry moves.              |
| 7. States completeness              |     3 | Loading is built from the card's own parts, so the grid does not resize on resolve (`loading-light.png`). A 90-character name truncates at two lines with a `title` tooltip (`overflow-long-title-light.png`). Nothing renders where nothing is known. |
| 8. Detail craft                     |     3 | At 200% the histogram sits on the text baseline, roll-up numerals align in their container, and the checkbox lands centred on the 40px mark it replaces. No horizontal overflow at 320px (`w320-light.png`, probe returns false).                      |

Gates: A11y ✅ · Responsive ✅ · Theme parity ✅ · No placeholder ✅ · Screenshot-verified ✅

**A11y**: every activity week keeps its own accessible name and an empty window says so in one;
the identity mark's tint is never the only carrier of health, because the label is always beside
it; the card's link takes focus with a visible ring; the selection checkbox keeps its label through
the glyph swap. **No placeholder**: this pass removed the last two — "Unowned" under every card
that had no owner, and the em dash under every card with no health set.

## What this pass changed

1. **"Unowned" is gone.** A table column needs a placeholder to keep rows aligned; a card does not,
   and on a roster where most Programs are unassigned it became the most repeated words on screen —
   the absence of information, set in type, once per card. The roll-up container keeps its place
   without it. `program-work-card.tsx`'s `ProgramOwner` now takes a non-null actor.
2. **Health tints the identity mark** (`HEALTH_GLYPH_CLASS` in `entity-display/health.tsx`).
   The mark was already there in neutral, so this spends no new colour and turns the card's largest
   element into its most useful one.
3. **The title moved to `title-large` and the summary to `body-medium`.** The card had one 16px
   line and then a wall of 11–12px text with no middle register.
4. **The roll-up sits in a tonal container.** Two runs of small text used to float against the right
   edge with nothing holding them; now the roll-up is one object in the same place on every card.
5. **The card gained a hover state.** It was a clickable surface with no hover treatment at all —
   only the checkbox appeared. It now steps to `surface-container-high`, matching `ListRow`.
6. **The skeleton was rebuilt from the card's parts** after the taller card outgrew it.

## Findings

1. **"At risk" is nearly colourless.** `--state-canceled` is `oklch(0.5 0.03 25)` — chroma 0.03, a
   near-grey, correct for cancelled work and wrong for a warning. On track (chroma 0.15) and off
   track both read instantly; the middle value, the one worth catching early, reads as beige in
   both themes. All four health modules borrow this token, so the fix is a `--health-at-risk` token
   in `globals.css` and a change to the health palette product-wide — a decision worth making
   deliberately rather than inside a card redesign. **Not fixed; needs a call.**
2. **The status pill is the loudest mark and the least informative one.** Every Program in a normal
   workspace is active, so nine identical filled blue pills carry no differentiating information
   while sitting at the top of the colour hierarchy. `WorkStatusBadge` fills only the `started`
   category, so this self-corrects in a workspace with paused or completed Programs — worth
   re-checking against mixed-status data before changing anything. **Watch.**
3. **The empty state names itself but does not teach.** "No programs yet" plus a Create button, with
   no `body` explaining what a Program is for — and its CTA duplicates the header's "New program",
   putting two filled primaries on one screen. It is shared by all four work-view targets
   (`work-view-page.tsx`), so a fix lands on Tasks, Projects, and Initiatives too. **Not fixed;
   out of this surface's scope.**
4. **`GET /work-views/defaults/:target` 404s** on a workspace with no stored default, twice per
   load, so a clean roster logs two console errors. The client handles it correctly by falling back.
   An API concern, unrelated to this work. **Not fixed.**

## Verdict

**SHIP.** Every dimension is at or above the bar and all five gates are green. Finding 1 is the one
worth acting on next, and it is a product-wide palette decision rather than a defect in this
surface.

## Follow-ups

- The card renders `status`, `health`, `owner`, `projectCount`, and `taskCount`. Switching on
  `labels`, `initiatives`, `visibility`, `creator`, or `updatedAt` still changes nothing on this
  lens; those need resolvers the card does not have.
- Non-Program targets share the rebuilt frame, the shared identity mark, and the hover state, but
  still render a generic label/value list. A Project card could carry its lead, dates, and progress
  the way this one carries its roll-up.
