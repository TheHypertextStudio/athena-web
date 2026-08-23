# Design review: Work-view popovers — 2026-08-23

This review covers Filter, Display, and View settings on the shared Tasks, Projects, Programs,
and Initiatives roster toolbar. The six screenshots are in
`screenshots/2026-08-23-work-view-popovers/`. Display was captured at 1440×900 and 390×844 in
light and dark. Filter and View settings were also captured at 1440×900 in light mode.

| Dimension                           | Score | Evidence                                                                                                                                                                   |
| ----------------------------------- | ----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity and voice         |     3 | The quiet surface treatment keeps Linear's compact utility-menu character while every color, type role, state layer, and shape comes from Docket's MD3 system.             |
| 2. Typographic craft                |     3 | Section labels, choice labels, form labels, and action labels use one semantic hierarchy. No popover adds raw font sizes or local weights.                                 |
| 3. Spatial rhythm and density       |     4 | Every surface is 288px wide with a 4px outer inset. Choice rows are 44px tall with 16px inline insets. Form controls use the shared 36px dialog step and 40px touch floor. |
| 4. Hierarchy and information design |     4 | Display separates Layout, Organize, and Properties. View settings separates view creation from workspace defaults. Filter separates property choice from advanced editing. |
| 5. Color discipline                 |     3 | Surfaces, selected rows, checkboxes, dividers, and focus rings use semantic roles. Light and dark screenshots retain the same hierarchy without raw color overrides.       |
| 6. Motion and feedback              |     3 | Shared menu state layers cover hover, focus, press, and selection. The selected-row shape now resolves to the MD3 Expressive 12px runtime radius instead of the 4px base.  |
| 7. States completeness              |     3 | Property selection has search and keyboard navigation. Advanced filtering owns Apply. Empty sort state has one action and no explanatory filler or disabled fake action.   |
| 8. Detail craft                     |     4 | All three surfaces align their right edge to the invoking toolbar control. A 320px touch-viewport check measured a 288px surface from x=12 to x=300 with zero overflow.    |

Gates: A11y PASS · Responsive PASS · Theme parity PASS · No placeholder PASS ·
Screenshot-verified PASS

The keyboard pass found a visible 3px inset focus ring on the selected layout row. Coarse-pointer
controls resolve to at least 40px, and the 44px choice rows make checkbox labels the full touch
target. The 320px pass measured `document.scrollWidth === window.innerWidth === 320`.

## Findings

1. Resolved: selected menu rows carried both the 4px base shape and the 12px selected shape, but
   Tailwind's emitted rule order left the 4px radius active. The selected-state utility now wins
   explicitly, and the design contract guards the required modifier.
2. Resolved: Filter, Display, and View settings previously chose their own widths, paddings,
   labels, row types, and action placement. They now compose the same menu geometry and focus
   treatment.

Verdict: SHIP. Every dimension meets a score of 3, and every hard gate passes.
