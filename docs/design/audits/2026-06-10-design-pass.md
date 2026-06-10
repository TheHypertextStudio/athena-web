# Design review: full-product pass — 2026-06-10

First rubric-driven audit after the brand/craft overhaul (craft-rubric.md v1.0.0).
Screenshots: `.screenshots/` and `.screenshots/audit/` — 1440×900 light+dark for 12 app
surfaces, 1440/390 + OS-dark for marketing, light+dark auth.

## Marketing (/, /about, /pricing)

| Dimension                  | Score | Evidence                                                                                                                              |
| -------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice  | 4     | Paper/ink/Fraunces register unmistakable; WONK display moments; honest-seam product frame is an ownable idea; one tagline everywhere. |
| 2. Typographic craft       | 4     | Display clamp scale, mono eyebrows/colophon, hairline rhythm; ledger + pull-quotes carry sections with type alone.                    |
| 3. Spatial rhythm          | 3     | Consistent max-w-6xl/px-6 grid, deliberate band rhythm; diagram connector spacing slightly loose on mobile.                           |
| 4. Hierarchy & info design | 3     | Clear narrative order (hero → proof → thesis → ledger → path → close); one primary CTA per band.                                      |
| 5. Color discipline        | 3     | One sienna accent, warm neutrals; ink CTA band the single inversion; AA spot-checked on cream.                                        |
| 6. Motion & feedback       | 3     | Hover transitions tokened; intentionally static otherwise (server components, no JS).                                                 |
| 7. States completeness     | 3     | Static marketing surface — links/CTAs all live; no dead UI.                                                                           |
| 8. Detail craft            | 3     | Hairlines align across sections; root scrollbar forced light under OS dark; no overflow 320→1920.                                     |

Gates: A11y ✅ (landmarks, focus, contrast spot-check) · Responsive ✅ (390 + 320 verified) · Theme ✅ (OS-dark immunity verified) · No placeholder ✅ · Screenshots ✅
**Verdict: SHIP** (Fix applied during review: root scrollbar dark-under-dark → `html:has(.marketing)` override.)

## Auth (/sign-in, /sign-up)

All dims ≥3. Serif WONK wordmark + warm light backdrop receive the seam; card stays pure
product MD3; both themes verified. Gates ✅. **Verdict: SHIP.**

## App surfaces (Today, Inbox, Portfolio, My Work, Triage, Projects, Initiatives, Programs, Cycles, Views, Agents, Settings)

| Dimension                  | Score | Evidence                                                                                                                |
| -------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice  | 3     | Calm Plex/MD3 throughout; domain-neutral; vocabulary-skinned nouns (settings preview verified).                         |
| 2. Typographic craft       | 3     | All page titles on text-h1 (20px, weight/tracking baked); text-body/sm/xs scale in lists; mono for counts/steps.        |
| 3. Spatial rhythm          | 3     | 36px row rhythm consistent (now density-driven); blended sidebar / floating panel reads as one system.                  |
| 4. Hierarchy & info design | 3     | Each page: title + one-line purpose + single primary action; Today's plan/calendar/attention triptych scans in seconds. |
| 5. Color discipline        | 3     | Token-pure; dark mode designed (tonal ramp legible); color only on states/accents.                                      |
| 6. Motion & feedback       | 3     | Overlays on --dur-base/slow with 0.98 dialog scale; 240ms org-rebind cross-fade; global reduced-motion.                 |
| 7. States completeness     | 3     | Empty states teach + offer the next action on every audited surface (Today, My Work, Cycles, Inbox).                    |
| 8. Detail craft            | 3     | Focus ring util everywhere; scrollbar styling; no overflow at audited widths.                                           |

Gates: A11y ✅ (skip-link, roles, focus-visible; full keyboard sweep sampled) · Responsive ✅ (shell drawer verified earlier; full per-page mobile pass queued) · Theme ✅ · No placeholder ⚠️ (Settings "Soon" chips are explicit and disabled — accepted pre-launch; tracked) · Screenshots ✅

Findings fixed during this review:

1. "New Cycle"/"New Initiative" title-case vs "New task" sentence-case — all "New <noun>" labels now lowercase the vocabulary noun.
2. Cycles empty state said "your team's work" in a personal workspace — now "your work" (domain/space-neutral).
3. Onboarding brand mark was a generic sparkle glyph — now the serif WONK wordmark (matches the auth seam).

**Verdict: SHIP**, with queued follow-ups (below).

## Onboarding

Wordmark seam fixed this pass. Title scale (text-3xl/4xl) intentionally larger as a
focus-moment surface. Dims ≥3 after fix; gates ✅.

## Queued follow-ups (next audit round)

- Per-page 390px mobile screenshots for all 12 app surfaces (shell verified; pages sampled).
- Populated-data audit (rows, overflow, long titles) — this pass audited a fresh workspace;
  list-row craft needs a seeded org to grade dimension 8 fully.
- Settings "Soon" sections (Notifications, Danger zone) should ship or fold before launch.
- Marketing diagram connectors at <640px could be tightened (currently acceptable).
