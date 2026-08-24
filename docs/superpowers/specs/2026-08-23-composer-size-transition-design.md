# Composer size transition

The shared create composer will keep one `max-w-2xl` width in both editor states. The default state
will use `min(34rem, 75dvh)`, and the expanded state will use `min(48rem, 85dvh)`. The description
editor will flex into the available vertical space instead of forcing the default state into a
112px editor.

Only height will transition when a person expands or collapses the editor. The transition will use
the shared slow duration and MD3 ease-in-out token. Reduced-motion preferences will disable the
transition. Opening and closing the dialog will retain the existing fade and scale motion.

This change belongs in `ComposerShell`, so Task, Project, Program, Initiative, Cycle, and Team
composers receive the same geometry. Tests will assert the stable width, both height presets, the
height-only transition, the flexing editor, state preservation, focus preservation, and the
reduced-motion class.

Content-measured JavaScript animation was rejected because the composer already has bounded modal
states, and measurement would add layout observers without improving the interaction. A viewport-
wide expanded state was rejected because description editing needs more vertical space, not a
different reading measure.
