# Work-template readability

Reader: The Docket maintainer reviewing the type correction after the work-first layout. Compare these captures with the [preceding composition review](2026-10-24-work-template-work-focus.md).

The larger layout exposed undersized text. This revision changes the MD3 roles on template-authoring content without increasing every control or changing the global type scale.

| Content                                                                   | Before                            | After               |
| ------------------------------------------------------------------------- | --------------------------------- | ------------------- |
| Starting document, child documents and rendered Review documents          | body-medium, 14/20                | body-large, 16/24   |
| Included-work names in the outline and Review                             | title-small or label-large, 14/20 | title-medium, 16/24 |
| Relative dates, responsibility, dependency details and useful helper copy | body-small, 12/16                 | body-medium, 14/20  |
| Phone step labels                                                         | label-small, 11/16                | label-large, 14/20  |

The 22–24px headings, 14px standard control labels and values, layout widths and control dimensions remain unchanged. Incidental draft/save metadata and step numerals retain their smaller roles. The editor override applies only to template-authoring surfaces. Other Docket documents retain their existing typography.

Live browser measurements confirm document text at 16/24, included-work names at 16/24, and dates, helper copy and phone step labels at 14/20. The private receipt is `.data/design-review/readability/computed-type.json`.

The authenticated screenshot matrix contains creation Purpose, Starting work, Review and long names/documents. Each state has 1440×900, 390×844, 320×844 and 390×600 captures in light and dark. The existing capture tool rejects horizontal overflow and uncaught runtime errors. Screenshots and receipts live in `.data/design-review/readability/`.

The craft assessment covers all eight rubric dimensions:

| Dimension                      | Score | Evidence                                                                                                                                            |
| ------------------------------ | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brand identity & voice         | 3     | The screen retains Docket's Plex type and named MD3 roles. No global scale or font changed.                                                         |
| Typographic craft              | 3     | Browser measurements confirm the intended 16px reading roles and 14px supporting roles. Headings retain their hierarchy.                            |
| Spatial rhythm & density       | 3     | Desktop still shows the document and both fixture tasks together. Phone text wraps at its existing gutter.                                          |
| Hierarchy & information design | 3     | The work remains primary, with defaults beside it on desktop and after it on phones.                                                                |
| Color discipline               | 3     | Both themes retain the existing semantic text colors and shared surfaces.                                                                           |
| Motion & feedback              | 3     | This change adds no motion and retains tested focus, save and navigation behavior.                                                                  |
| States completeness            | 3     | The matrix covers blank creation, populated editing, publication review and long content. Existing behavior coverage remains in the template suite. |
| Detail craft                   | 3     | The 320px step labels wrap within their buttons. Short-phone creation keeps Back and Continue visible. Dates wrap without horizontal overflow.      |

The five local-review gates pass: keyboard/focus behavior retains its existing tested implementation, narrow layouts fit, both themes render, the controls operate on real authenticated fixtures, and screenshots show the result. Verdict: SHIP for this typography revision. This is not a deployment or user-approval claim.

Long content still requires scrolling. This revision does not promise that all content fits above the fold. The worklog records validation and cleanup; no persistence, permission, API or schema changes belong to this slice.
