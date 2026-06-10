---
name: design-review
description: Run the Docket Craft Rubric against a live surface — capture screenshots at two widths and both themes, score all eight dimensions with evidence, check the hard gates, and write a scorecard to docs/design/audits/. Use when asked to design-review a page/surface, audit UI craft, or verify a surface meets the ship bar.
---

# /design-review <surface-or-route>

Evaluate a surface against `docs/design/craft-rubric.md`. The output is a scorecard with evidence, not opinions.

## Arguments

- A route (`/today`, `/`, `/pricing`, `/sign-in`, `/onboarding`) or a surface name (resolve to its route).
- Optional `--fix`: after scoring, fix findings until the surface meets the ship bar, re-screenshot, and re-score.

## Procedure

1. **Read the rubric first**: `docs/design/craft-rubric.md`. Identify the surface's register (marketing = paper/ink editorial; app = calm Plex/MD3; auth/onboarding = seam).

2. **Ensure the dev server is running** (`pnpm dev` in background if not already — it should generally already be up). Confirm the route renders without console errors.

3. **Capture the standard shot set** with browser tooling (chrome-devtools or playwright MCP):
   - 1440×900 light, 1440×900 dark, 390×844 light, 390×844 dark.
   - Marketing surfaces: light at both widths, plus one shot with OS/`prefers-color-scheme: dark` emulated to verify the light-only rendering holds (scrollbars, over-scroll, form controls).
   - For surfaces with meaningful states, also capture: empty state, loading (throttle or intercept if needed), and one overflow case (long titles / many items) when reachable.
   - Check for horizontal overflow at 320px width (`document.documentElement.scrollWidth > innerWidth`).

4. **Score all eight dimensions 1–4.** Every score must cite concrete evidence visible in a screenshot or the DOM (element, file:line when known). No evidence → no score.

5. **Check the five hard gates** (a11y, responsive, theme parity, no placeholder, screenshot-verified). For a11y, spot-check: keyboard-tab through the primary flow, verify focus visibility, run a contrast check on suspect pairs (especially tinted surfaces / cream marketing palette).

6. **Write the scorecard** to `docs/design/audits/YYYY-MM-DD-<surface>.md` using the format in the rubric, including screenshot paths and findings ordered by severity with proposed fixes.

7. **Verdict**: SHIP (all dims ≥3, gates green) or BELOW BAR (list exactly what blocks). With `--fix`, loop: fix top findings → re-screenshot → re-score, until SHIP.

## Rules

- Screenshots are the ground truth. Never assert a visual property you haven't captured.
- "Competent" (2) is a failing score at ship time — say so plainly.
- Findings name files and lines where possible so fixes are immediately actionable.
- Do not invent demo data to make a surface look full; empty states are part of the review.
