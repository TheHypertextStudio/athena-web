# Design review: API reference — 2026-09-19

Reader: the engineer deciding whether the public Scalar reference is ready to ship. After reading
this review, they should know which viewports and behaviors were checked and whether the surface
meets the Docket craft bar.

Screenshots were captured during the browser review at 1440×900 and 390×844 in light and dark
themes, plus a 320×844 overflow check. The browser captures remain attached to the implementation
task rather than checked into the repository.

| Dimension                 | Score | Evidence                                                                                                                                       |
| ------------------------- | ----: | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Brand identity & voice |     3 | The cream paper, warm ink, burnt-sienna mark, Docket header, and plain API copy make the reference identifiable without fighting Scalar.       |
| 2. Typographic craft      |     3 | IBM Plex Sans is self-hosted and computed on both the Docket frame and Scalar root. Headings, body copy, labels, and code form a clear system. |
| 3. Spatial rhythm         |     3 | The desktop uses a stable three-column reference layout. Mobile collapses to one readable column with consistent 24 px content insets.         |
| 4. Information design     |     3 | The introduction leads with capabilities and access. Eight named tag groups keep 522 operations navigable. Search and deep links work.         |
| 5. Color discipline       |     3 | The surface uses neutral theme tokens with one accent. Light and dark screenshots preserve hierarchy and readable contrast.                    |
| 6. Motion and feedback    |     3 | Loading and terminal error states are explicit. Focus rings are visible, and the reduced-motion media query disables transitions and scroll.   |
| 7. States completeness    |     3 | The shell supplies loading, retry, request ID, direct-spec, and terminal failure states. The live reference reached ready without errors.      |
| 8. Detail craft           |     3 | All visible buttons measure at least 44×44 px. The 320 px layout has no document overflow, and the compact header avoids title clipping.       |

Gates: A11y ✅ · Responsive ✅ · Theme parity ✅ · No placeholder ✅ · Screenshot-verified ✅

The browser review also confirmed that the reference loads only same-origin resources, keeps the
OpenAPI download under Docket's origin, preserves an operation hash through reload, exposes search
and Test Request controls, and logs no browser warnings or errors.

Verdict: SHIP BAR MET.
