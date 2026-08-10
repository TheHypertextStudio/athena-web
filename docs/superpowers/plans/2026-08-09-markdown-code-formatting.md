# Markdown Code Formatting Implementation Plan

> **For agentic workers:** Follow test-driven development and verify every gate before integration.

**Goal:** Deliver pristine inline-code and fenced-code authoring and display across Docket's shared
Markdown surfaces, with lazy syntax highlighting and a production-main landing.

**Architecture:** Extend Tiptap's code-block node with an immediate fence rule, a lazy Lowlight
decoration plugin, and a React node view. Keep Markdown as the storage contract and route comment
display through the same read-only renderer.

**Tech stack:** React, Tiptap 3, ProseMirror, Lowlight/Highlight.js, Vitest, Playwright, Tailwind/MD3.

---

### Task 1: Pin the behavior with failing tests

- Add editor tests for inline/fenced Markdown round-trips, immediate line-start triple backticks,
  mid-line non-conversion, language selection, copy feedback, and read-only rendering.
- Add loader tests proving per-language deduplication, alias handling, no-load fallbacks, failure,
  and subscriber cleanup.
- Run the targeted tests and confirm each fails for the missing behavior before implementation.

### Task 2: Build the language and code-block units

- Add the Tiptap code-block, Lowlight, and Highlight.js dependencies through pnpm.
- Implement the typed catalog and loader with fixed grammar imports and observable load state.
- Extend CodeBlock with the immediate input rule and an async-safe decoration plugin that refreshes
  without writing to history or Markdown.
- Implement the quiet node view with edit/read-only language affordances and exact-copy feedback.
- Run the targeted tests to green, then refactor without changing behavior.

### Task 3: Integrate every shared Markdown surface

- Replace StarterKit's code block in `FreeformTextEditor`, isolate inline-code styling, and map
  syntax classes to semantic color tokens.
- Preserve mentions, link upgrades, slash commands, reconciliation, autosave, and host shortcuts.
- Render posted comments with `FreeformText` so authored Markdown displays consistently.
- Run the full web unit suite and repair regressions before continuing.

### Task 4: Prove persistence and visual craft

- Add one real-stack E2E journey covering project autosave/reload and comment post/read/copy.
- Exercise known and unknown languages, a mid-line fence, long lines, and exact clipboard output.
- Capture desktop/mobile light/dark evidence for document and compact surfaces; score the Craft
  Rubric and fix findings until every dimension is at least 3 and every hard gate is green.

### Task 5: Validate and land

- Run root typecheck, lint, test, and build from the final rebased commit.
- Complete the WORKLOG entry and self-review the owned diff.
- Commit one coherent `feat(web)` slice with a substantive body, rebase onto fresh `origin/main`,
  rerun affected and full gates, fast-forward production main, push, and verify remote-main and
  deployment checks point at the landed commit with zero merge commits.
