# App Overscroll Background Design

## Objective

Prevent browser overscroll from revealing a document canvas whose colour differs from the
authenticated app shell.

## Design

The root document body will use the semantic `bg-surface-container` utility. `AppShell` already
uses that exact token for its tinted canvas, so the browser backdrop and the visible shell will
resolve through the same light and dark theme values.

The shell's `<main>` remains `bg-surface`. Its white or dark page panel is intentionally a distinct
tonal surface floating on the shell canvas and is not part of this fix. Marketing, authentication,
onboarding, and other route groups retain their existing explicit full-page surface treatments.

## Alternatives Considered

- A raw `background-color: var(--surface-container)` declaration would produce the same pixels but
  duplicate the semantic utility already used by the shell.
- Route-specific JavaScript that mutates the document body would avoid a global root class, but it
  introduces lifecycle and transition states for an invariant the root layout can express directly.

## Validation

- Add a root-layout contract test that renders the layout and asserts the body carries
  `bg-surface-container`.
- Keep the existing shell contract asserting that `AppShell` uses `bg-surface-container` and its
  `<main>` uses `bg-surface`.
- Run the targeted tests, then the repository typecheck, lint, test, and build gates.
