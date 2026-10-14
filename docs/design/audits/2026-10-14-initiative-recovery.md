# Design review: recovered Initiative connected work

The review covers project creation/linking inside an Initiative, Program grouping, expandable
project details, and object-owned unlink actions. Typed-template identity is a subsequent layer.

The authenticated local runtime contains a community-dinner fixture seeded through the API.
Sixteen accepted captures under `apps/web/.data/design-review/2026-10-14-initiative-recovery/`
(`grouped` and `expanded`) cover 1440×900, 390×844, 320×844, and 390×600 in both themes.
The earlier loose-work captures are exploratory evidence, not the final acceptance set.

| Dimension                        | Score | Evidence                                                                                                               |
| -------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------- |
| Brand identity and voice         | 3     | Work is named by its purpose; creation, linking, and removal use ordinary object actions.                              |
| Typographic craft                | 3     | Initiative title, Program heading/count, project title, summary, and expanded facts have distinct shared roles.        |
| Spatial rhythm and density       | 3     | A Program encloses its projects and add field. Expanded facts align with the project title at desktop and touch sizes. |
| Hierarchy and information design | 3     | Program containers and Project rows express containment; the root add field remains outside the Program.               |
| Color discipline                 | 3     | Named shared surfaces distinguish the containing Program and its projects in both themes.                              |
| Motion and feedback              | 3     | Disclosure, keyboard selection, retained input focus, and failed-create retry have behavior coverage.                  |
| States completeness              | 3     | Tests cover empty/read-only, inherited work, errors, retries, selection, and on-demand detail.                         |
| Detail craft                     | 3     | Final captures pass overflow checks. Browser acceptance proves the 40px phone disclosure target and collapse/reopen.   |

## Findings and acceptance

The retained branch's floating match list and resting containers now use shared UI primitives.
Existing matches preserve input focus and expose active-descendant navigation. Outside interaction
closes matches without discarding the typed name; IME confirmation does not create work.
Suggestions inside a Program include only existing projects already filed there. Explicit Move
continues to own placement changes.

Fresh inspection found a 20px disclosure target. A browser regression reproduced it; the shared
Button supplies a 40px touch floor, and expanded-content alignment accounts for both control sizes.
The final authenticated journey creates consecutive loose projects, creates inside a Program,
verifies persisted placement, links existing work, unlinks through its own menu, and collapses/reopens
on a short phone. All cases pass.

Responsive, theme, populated-content, keyboard/focus, and focused accessibility gates pass for this
recovery slice. This review does not establish a complete screen-reader audit, provider acceptance,
or production deployment. Verdict: accepted for source integration after affected checks pass.
