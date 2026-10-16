# Design review: Work-template gallery and reentry — 2026-10-15

Register: app, IBM Plex / MD3. Scope: library, nonprofit browse, Event detail,
first-use choice, single-Event review, full 60-root startup review, focused work
inspection and saved-copy reentry. This review evaluates the
guided, revisitable definition of organizational work. It does not certify the
rest of Settings, the full template editor or production deployment.

## Captured evidence

The canonical authenticated stack produced 64 final captures across eight states, eight per state: 1440×900,
390×844, 390×600 and 320×844, each in light and dark. The reviewer inspected the
desktop-light and short-phone-dark image for every surface, plus standard-phone,
320px and opposite-theme representatives. Account content was populated through
the actual API; the gallery uses the approved catalog. These are local runtime captures; the
implementation is not yet shipped.

| Surface             | Desktop, light                                                                                                                                                | Short phone, dark                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Library             | [1440×900](/Users/williecubed/.codex/recovery/2026-10-14-athena/gallery-final-library/orgs-orgId-settings-templates-1440x900-light.png)                       | [390×600](/Users/williecubed/.codex/recovery/2026-10-14-athena/gallery-final-library/orgs-orgId-settings-templates-390x600-dark.png)                       |
| Nonprofit browse    | [1440×900](/Users/williecubed/.codex/recovery/2026-10-14-athena/gallery-final-nonprofit-verified/orgs-orgId-settings-templates-gallery-1440x900-light.png)    | [390×600](/Users/williecubed/.codex/recovery/2026-10-14-athena/gallery-final-nonprofit-verified/orgs-orgId-settings-templates-gallery-390x600-dark.png)    |
| Event detail        | [1440×900](/Users/williecubed/.codex/recovery/2026-10-14-athena/gallery-final-detail/orgs-orgId-settings-templates-gallery-event-1440x900-light.png)          | [390×600](/Users/williecubed/.codex/recovery/2026-10-14-athena/gallery-final-detail/orgs-orgId-settings-templates-gallery-event-390x600-dark.png)          |
| Event review        | [1440×900](/Users/williecubed/.codex/recovery/2026-10-14-athena/gallery-final-review-verified/orgs-orgId-settings-templates-gallery-event-1440x900-light.png) | [390×600](/Users/williecubed/.codex/recovery/2026-10-14-athena/gallery-final-review-verified/orgs-orgId-settings-templates-gallery-event-390x600-dark.png) |
| Full startup review | [1440×900](/Users/williecubed/.codex/recovery/2026-10-14-athena/gallery-final-startup-verified/orgs-orgId-settings-templates-gallery-1440x900-light.png)      | [390×600](/Users/williecubed/.codex/recovery/2026-10-14-athena/gallery-final-startup-verified/orgs-orgId-settings-templates-gallery-390x600-dark.png)      |

Additional inspected states:

- First use: [desktop light](/Users/williecubed/.codex/recovery/2026-10-14-athena/gallery-final-first-use-contained/orgs-orgId-settings-templates-gallery-1440x900-light.png), [short phone dark](/Users/williecubed/.codex/recovery/2026-10-14-athena/gallery-final-first-use-contained/orgs-orgId-settings-templates-gallery-390x600-dark.png).
- Saved-copy reentry: [desktop light](/Users/williecubed/.codex/recovery/2026-10-14-athena/gallery-final-bundle-verified/orgs-orgId-settings-templates-gallery-copies-01M51988Y5CK48SJTVDD773ZJY-1440x900-light.png), [short phone dark](/Users/williecubed/.codex/recovery/2026-10-14-athena/gallery-final-bundle-verified/orgs-orgId-settings-templates-gallery-copies-01M51988Y5CK48SJTVDD773ZJY-390x600-dark.png).
- Focused Event inspection: [desktop light](/Users/williecubed/.codex/recovery/2026-10-14-athena/gallery-final-focused/orgs-orgId-settings-templates-gallery-event-1440x900-light.png), [short phone dark](/Users/williecubed/.codex/recovery/2026-10-14-athena/gallery-final-focused/orgs-orgId-settings-templates-gallery-event-390x600-dark.png).

## Eight dimensions

| Dimension                         | Score | Evidence                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice         | 3     | Plex and neutral MD3 surfaces fit the app register. “Continue defining”, “Choose starting work” and “Keep private drafts” describe a revisitable work-definition flow. Event inspection presents real venue/preparation structure.                                                                                                                                                                               |
| 2. Typographic craft              | 3     | Library page title, section headings and work rows have distinct weight and scale. Event review removes the former category/kind/title stack for one selection; Inspect and item count are subordinate to the work name. Saved-copy reentry now has one page heading above Continue defining and Chosen work.                                                                                                    |
| 3. Spatial rhythm & density       | 3     | Library rows align, with Vendor booking indented under Event. Outcome groups share consistent padding and row rhythm. Short-phone browse reaches actual work after compact context controls. Corrected first-use audience choices contain their wrapped descriptions with clear separation at 320px in both themes. Shared shapes use 16px outer and 12px inner radii.                                           |
| 4. Hierarchy & information design | 3     | Unfinished definitions precede published management. Browse leads with organizational outcomes. Review puts selected work before destination/visibility and gives acceptance the sole filled primary action. Reentry explains Event’s dependency next to Review Vendor booking. All 60 startup selections remain represented without mounting 60 outlines.                                                       |
| 5. Color discipline               | 3     | Light and dark representatives retain distinct neutral surface levels; the accent identifies links and primary actions. No decorative category colors compete with the work. The tested Keep action meets 4.5:1 in both themes; this is not a whole-page contrast certification.                                                                                                                                 |
| 6. Motion & feedback              | 3     | Actual E2E verifies checkbox feedback with focus retained, Inspect/Back focus return, saved outcome after reload, and real Undo/reentry. Keep and reentry remain usable with reduced motion. Controls reuse shared primitives. A 100ms latency benchmark was not performed.                                                                                                                                      |
| 7. States completeness            | 3     | Corrected nonprofit short-phone-dark shows actual Cohort/Program delivery instead of a false empty state. Pending fork facts now remain loading; unavailable/mismatched facts receive a separate recoverable state, covered by the UI owner’s focused regressions. First use, full selection, saved reentry and Undo use actual server outcomes.                                                                 |
| 8. Detail craft                   | 3     | Row chevrons and Inspect labels distinguish actions from prose. Nested work indentation survives phone layout. Shared controls preserve focus and touch size in the exercised journey; 320px review/reentry/full-fork checks pass. Corrected first-use 320px touch buttons contain every label without overlap; other inspected populated states show no clipping. Singular required-template copy is corrected. |

## Hard gates and limits

| Gate                | Status                                      | Evidence and limits                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A11y                | Pass for exercised flow                     | Actual E2E covers Enter/Space, checkbox focus retention, Inspect/Back focus return, visible primary-action focus, ≥4.5:1 primary-action contrast in light/dark, ≥40px primary touch target and reduced-motion use. A dedicated hasTouch:true case also proves all four first-use labels fit inside their actual buttons without adjacent-button overlap at 320px in both themes. Full screen-reader navigation and every control’s contrast were not tested in this review. |
| Responsive          | Pass for captured widths and exercised flow | Inspected 320/390/1440px frames reflow intentionally. E2E checks no horizontal overflow at 320px for review, reentry and full-fork review. The stack owner reports all eight standard capture runs completed with zero overflow and exit 0. Corrected first-use 320px captures show full button containment in both themes, independently checked by actual touch-layout E2E. Intermediate widths and 1920px were not individually inspected.                               |
| Theme parity        | Pass                                        | Actual light/dark representatives were inspected, including corrected nonprofit facts and saved-copy/first-use states. Neutral surface hierarchy remains legible in both themes.                                                                                                                                                                                                                                                                                            |
| No placeholder      | Pass in inspected scope                     | Canonical catalog definitions and API-created drafts supply the content. Inspection and acceptance have real behavior; no simulated success is used. Catalog choices are visibly starting definitions, with no work creation or schedule start claimed.                                                                                                                                                                                                                     |
| Screenshot-verified | Pass                                        | Every visual claim is tied to captured surfaces. Interaction evidence comes separately from the actual E2E log below.                                                                                                                                                                                                                                                                                                                                                       |

## Resolved findings

1. **First-use audience choices overlapped at 320px.** The coarse-pointer
   fixed-height class overrode automatic height. Rich choices now grow with their
   labels. Both corrected [320×844 light](/Users/williecubed/.codex/recovery/2026-10-14-athena/gallery-final-first-use-contained/orgs-orgId-settings-templates-gallery-320x844-light.png)
   and [320×844 dark](/Users/williecubed/.codex/recovery/2026-10-14-athena/gallery-final-first-use-contained/orgs-orgId-settings-templates-gallery-320x844-dark.png)
   frames were inspected. The new actual-touch E2E asserts label containment and
   next-button separation in both themes; the final three-case run is green.
2. **False empty state while fork facts were pending.** The earlier nonprofit
   390×600 dark capture displayed zero matches while the same selection was
   populated elsewhere. The browse page now gates both catalog and fork loading
   and treats unavailable/mismatched facts separately. The focused UI regressions
   and corrected nonprofit capture close this finding; the final affected E2E is
   green.
3. **Singular required-template copy.** Corrected Event review displays
   “1 required template” and “1 selected · 2 templates”.
4. **Saved-copy heading and next-action hierarchy.** Corrected reentry uses
   “Saved starting work” as the page heading, followed by “Continue defining” and
   “Chosen work”. The primary Vendor booking action now explains that Event uses
   it and it should be reviewed/published first. First-use introduction is shorter.

No remaining below-bar finding was confirmed in the inspected scope. This review
does not extend to the full editor or unexercised states elsewhere.

## Actual behavior evidence

The final [E2E log](/Users/williecubed/.codex/recovery/2026-10-14-athena/gallery-organization-final-e2e-contained.log)
records **3 passed (12.3s)** in
`apps/web/e2e/work-template-gallery.spec.ts`: actual private Event
install/reload/reentry/Undo, complete 60-root startup review, and 320px first-use
touch-label containment in both themes. The reviewer read
the spec and final execution log and used only their bounded assertions above.
The tests confirm actual Book venue inspection, retained keyboard focus, private
copy response/reload, real Undo and no page errors. The full-fork case verifies
60 distinct selected roots and no mounted Included work outlines.

The final E2E follows the first-use button-height correction. The source-only
bundle function extraction changes no rendered behavior.
No browser, server or database operations were run by this reviewer. The [capture receipt](/Users/williecubed/.codex/recovery/2026-10-14-athena/gallery-organization-capture-receipt.json)
records the canonical capture tool, frame hashes and bounded overflow checks.
Final source-manifest binding is maintained by the stack owner in the private
recovery record.

**Verdict: SHIP for the reviewed local UI surface.** All eight dimensions score
3 and the five gates pass within the stated evidence bounds. This is a source/UI
acceptance verdict. The production migration-role prerequisite is verified separately
in the worklog. Production deployment and runtime acceptance remain independently
open; this scorecard alone does not establish release acceptance.
