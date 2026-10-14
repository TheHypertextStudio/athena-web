# Design review: approachable work setup — 2026-10-03

> **Verdict withdrawn on 2026-10-04.** The user rejected the spatial design. The screenshot shows an oversized sparse panel and unclear editing affordances. The passing scores below are historical claims, not current approval. See the layout correction worklog entry.

Reader: A Docket maintainer reviewing the template copy and presentation follow-up.

The revised template editor meets the Craft Rubric for this change. Docket retains the same work fields, permissions, and recurrence behavior. The shipped examples now include individual, client, business, and nonprofit work. They remain editable data rather than product types.

## Evidence

Authenticated captures came from the repository's dev-session and capture-shots tools. The account used the actual default-seeding endpoint. The screenshot root is `.data/design-review/2026-10-03-approachable-work/` in this checkout. Basics, Work, and Review each have eight frames: 1440×900, 390×844, 320×844, and 390×600 in both themes. The business editor has desktop and 390px frames in both themes. Every capture passed the tool's document overflow check.

An independent product review inspected the Client project desktop and phone captures and found no blocking visual issue. The final captures also show the corrected Health picker label. The [original interaction review](2026-10-03-work-template-ui.md) records unchanged focus, dismissal, recurrence, and failure behavior.

## Scores

| Dimension                        | Score | Evidence                                                                                                                                                                                                              |
| -------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brand identity and voice         | 3     | Client project and Running a business describe recognizable work. When to use it distinguishes template guidance from the work's description. Workspace vocabulary remains configurable.                              |
| Typographic craft                | 3     | The saved template name and type identify the overlay. Section labels remain subordinate to the editor's name and document headings. Shared app tokens preserve the hierarchy in both themes.                         |
| Spatial rhythm and density       | 3     | The document and settings share consistent insets. Desktop gives writing a flexible column; phone stacks settings below the editor. Removing the extra editor surface restores the ordinary composer presentation.    |
| Hierarchy and information design | 3     | Basics edits identity and sharing. Work edits starting values. Review separates the usage note, work preview, and starting settings. Save changes remains the only primary action.                                    |
| Color discipline                 | 3     | Shared tonal surfaces and semantic controls retain light/dark parity. The primary button and selected tab use the existing accent tokens.                                                                             |
| Motion and feedback              | 3     | Shared dialog and picker behavior is unchanged. Template tests still cover pending saves, retained drafts, application-owned failures, and discard confirmation.                                                      |
| States completeness              | 3     | Tests cover all four kinds, empty usage notes, optional work names, renamed templates, and Campaign vocabulary. Persisted browser tests create and reopen every kind. Empty names now explain when the name is added. |
| Detail craft                     | 3     | Captures show aligned editor and settings edges, a visible footer at 320px and short-phone heights, and no clipped labels. Health and Clear health name the field and action without awkward unset-state copy.        |

## Gates and limits

All five gates pass for the changed surface. Shared keyboard, focus, contrast, and touch treatments remain intact from the original interaction review. Responsive and theme gates have fresh captures. Every control retains its existing persisted behavior. The screenshots show real seeded templates rather than a standalone preview.

This evidence establishes presentation and saved behavior. It does not establish corporation-scale performance or usability. The change preserves the existing organizational model; it adds no new scale guarantees. Existing saved templates are not rewritten. Only empty workspaces receive the revised catalog.

## Decisions

The editor keeps template usage notes separate from work descriptions because they answer different questions. Empty optional work names use quiet explanatory copy instead of an error-like headline. The catalog spans personal and organizational examples without forcing people to choose a business category. The follow-up preserves the approved three-step setup and direct editing navigation.
