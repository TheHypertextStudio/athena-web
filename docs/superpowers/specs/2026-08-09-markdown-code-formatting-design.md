# Markdown Code Formatting Design

## Objective

Make inline code and fenced code blocks first-class Markdown content everywhere Docket authors or
reads rich text. The result must stay quiet and document-like, preserve Markdown exactly enough to
round-trip language fences, and avoid loading syntax grammars a document does not use.

## Authoring

Inline code uses Tiptap's native backtick input rule and Cmd/Ctrl+E shortcut. Typing exactly three
backticks at the start of an otherwise empty paragraph converts immediately to a code block; the
existing slash command and code-block keyboard shortcut remain available. The immediate rule does
not answer mid-line backticks.

Code blocks use a slim tonal rail above an IBM Plex Mono editing surface. Editable blocks expose a
language selector and Copy; read-only blocks expose a language label and Copy. The language is the
code node's durable attribute and serializes as the Markdown fence info string. Unknown fence ids
remain visible and round-trip unchanged without guessed highlighting.

## Highlighting and loading

A typed catalog covers Bash/shell, CSS, diff, HTML/XML, JavaScript/JSX, JSON, Markdown, Python, SQL,
TypeScript/TSX, and YAML. Each grammar is a fixed dynamic import. One loader caches in-flight and
completed imports; plain-text and unknown-language blocks import nothing. Highlighting is a
ProseMirror decoration, never document content, so load success or failure cannot alter selection,
undo history, autosave, or stored Markdown.

## Presentation and accessibility

The visual direction is quiet precision: semantic MD3 tonal surfaces, a thin outline, restrained
syntax colors, and no terminal decoration. Inline code is a compact semantic-token pill and is
styled independently from code inside a block. Long lines scroll inside the block without widening
the page. Language and Copy controls are keyboard reachable, retain visible focus, meet the mobile
touch target, and announce copy success or failure without changing layout.

## Verification

Unit and component tests cover Markdown round-trips, immediate and non-triggering fence input,
lazy-loader state, language changes, exact copy output, read-only behavior, and coexistence with
mentions and slash commands. A real-stack Playwright journey authors, persists, reloads, renders,
and copies code through project and comment surfaces. The Docket Craft Rubric must pass at desktop
and mobile widths in both themes, including a 320px overflow check. Root typecheck, lint, test, and
build gates must all pass before the feature lands linearly on production main.
