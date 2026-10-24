# Work-template authoring: work-first composition

Reader: The Docket maintainer reviewing the October 24, 2026 authoring changes. Use the screenshots to judge the composition; the test results establish behavior only.

## Decision

Starting work now shows the work name, document and included hierarchy in one main column. Desktop uses an 1120px content region with a 272px defaults column. Phones place defaults after the work. Review renders the document directly and shows the full included hierarchy alongside it on desktop.

The prior [authoring audit](2026-10-23-work-template-authoring-refinement.md) overstated the visual result. Its technical evidence remains useful, but its composition verdict does not establish approval for this revision. The user found the previous design empty. This revision removes full-width settings containers and the repeated starting-work introduction. It gives the work name more weight than the template heading.

The creation stepper, direct editing sections, in-memory draft retention and publication contracts remain unchanged. The included-work shortcut uses the same creation validation and reached-step state. Read-only authors see View included work rather than an edit promise. Blank read-only definitions do not show an Add action.

## Rendered evidence

Screenshots live in `.data/design-review/work-focus/`. `accepted-captures.json` selects the latest successful frame per state, viewport and theme. All captures use authenticated API-created fixtures in the actual app. Quarterly finances is editable verification data.

The matrix covers desktop at 1440×900, phones at 390×844 and 390×600, and 320×844. Each size has light and dark captures. States cover creation Purpose, creation Starting work, populated editing, Review, all four work kinds, long names/documents, expanded summary settings, and read-only presentation. The read-only response is simulated; it proves presentation, not server authorization.

The shared screenshot tool checks horizontal overflow and rejects uncaught runtime errors. A failed request during the first Review capture was replayed; failed frames are excluded. The original capture scenario requests contained unresolved workspace placeholders. Concrete authenticated fixture IDs corrected those private inputs without modifying the capture tools.

## Craft assessment

| Dimension                      | Score | Evidence                                                                                                                                                                                                           |
| ------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Brand identity & voice         | 3     | Plex type and existing Docket controls remain consistent. User data supplies the work names and document. The Purpose heading no longer repeats the entered name.                                                  |
| Typographic craft              | 3     | The work name uses a larger text token than the template heading. Document headings, list text and child names have separate levels.                                                                               |
| Spatial rhythm & density       | 3     | The document and included items share one left edge. The 272px defaults column aligns its fields. Phones retain one content gutter.                                                                                |
| Hierarchy & information design | 3     | Desktop shows the document and both included fixture tasks together. Phones show the same work before defaults. Review exposes the document without a disclosure.                                                  |
| Color discipline               | 3     | One shared tonal settings surface groups defaults. The document remains the dominant editing surface. Both themes preserve this relationship.                                                                      |
| Motion & feedback              | 3     | Section changes use existing focus and scroll restoration. Clean save status stays accessible without a second visible saved label. Save failures and pending navigation retain their existing tested behavior.    |
| States completeness            | 3     | Captures cover blank creation, populated editing, long work, expanded controls and simulated read-only presentation. Seven browser checks cover actual saves, reopening, sharing and publication.                  |
| Detail craft                   | 3     | Work-name and document bounds align. The compact included outline retains optionality and relative dates. The 320px captures fit without horizontal overflow, and the short-phone creation footer remains visible. |

These scores describe this revision. They do not claim user approval or distinctive visual quality beyond the screenshots.

## Acceptance and limits

The five gates pass for this local review: accessibility spot checks, responsive bounds, theme parity, working controls without fabricated content, and actual screenshots. Verdict: SHIP for this UI revision. This verdict is not a deployment claim or a substitute for user approval.

Keyboard spot checks cover section-entry focus and the existing short-phone save flow. Shared fields supply focus treatment and text/control colors. The screenshot matrix covers both themes and 320px overflow. There are no fabricated work items, dead preview controls or new horizontal separator lines.

The preview shows authored relative rules rather than invented calendar dates. Full responsibility, dependency and nested-version details remain in Included work and Review. Long documents and large hierarchies still require scrolling. No database migration, API contract change, autosave or reload recovery was introduced.

The final worklog entry records check outcomes and build evidence. This delivery does not integrate, push or deploy the branch.

## Retrospective

The main improvement came from placing existing work content together, not from adding another decorative surface. Removing the redundant heading required an explicit focus destination. Reusing the full review renderer initially made the inline outline too verbose; its compact presentation now retains names, optionality, parentage and dates while the full review retains the rest.
