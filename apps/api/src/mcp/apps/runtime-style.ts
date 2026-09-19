/**
 * `@docket/api` — the stylesheet every Docket MCP App widget shares.
 *
 * @remarks
 * Split out of `./runtime` for the same reason as the script: it is one authored artifact the
 * host serves verbatim, and assembling it from fragments would cost readability for nothing.
 */

/**
 * The shared stylesheet, written entirely against the extension's standardized custom properties.
 *
 * @remarks
 * Every name used here is a member of the spec's `McpUiStyleVariableKey` union, which is what a
 * host actually supplies — asking for a name outside it means the declaration silently never
 * arrives. `runtime-tokens.test.ts` parses the vendored spec and fails the build if that drifts.
 *
 * The `:root` values are literals, never `var(--x, …)` self-references. A custom property that
 * references itself is a dependency cycle, and CSS resolves cycles to guaranteed-invalid *before*
 * it would reach the fallback — so a self-referencing declaration is not a default, it is a
 * deleted property. A host-supplied value arrives as an inline style on the root element and
 * outranks these regardless.
 *
 * The fallbacks are `light-dark()` pairs and both halves clear AA against the surface they sit on,
 * because the spec explicitly permits a host to supply some colours and not others. `color-scheme`
 * decides which half applies, and {@link RUNTIME_JS} pins it to the host's declared theme.
 *
 * Inline widgets must not scroll or open popovers — they sit inside someone else's transcript, and
 * a nested scroll region there is a trap.
 */
export const RUNTIME_CSS = String.raw`
:root {
  color-scheme: light dark;

  --color-background-primary: light-dark(#ffffff, #1c1c20);
  --color-background-secondary: light-dark(#f4f4f6, #26262c);
  --color-background-tertiary: light-dark(#e8e8ec, #303038);
  --color-text-primary: light-dark(#18181b, #f2f2f4);
  --color-text-secondary: light-dark(#52525b, #b1b1bd);
  --color-text-tertiary: light-dark(#6b6b76, #9595a1);
  --color-text-info: light-dark(#1d4ed8, #8ab0f8);
  --color-text-danger: light-dark(#b42318, #f9a8a0);
  --color-text-success: light-dark(#15803d, #7fd6a0);
  --color-border-primary: light-dark(#e4e4e7, #3a3a44);
  --color-ring-primary: light-dark(#2563eb, #8ab0f8);

  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-text-sm-size: 0.8125rem;
  --font-text-md-size: 0.875rem;
  --font-text-sm-line-height: 1.4;
  --font-text-md-line-height: 1.45;
  --font-heading-xs-size: 0.9375rem;
  --font-heading-xs-line-height: 1.35;

  --border-radius-md: 6px;
  --border-radius-lg: 10px;
  --border-radius-full: 999px;

  /* Workflow-state colours, which the extension standardizes no vocabulary for. These are
     Docket's own --state-* ramp verbatim, so a card in a foreign host still reads in Docket's
     state language; Docket's own host overrides them with the live tokens. Anything outside the
     spec's union has to be declared here or the widget receives nothing — see WIDGET_OWNED in
     mcp-apps-tokens.test.ts. */
  --state-backlog: light-dark(oklch(0.5 0 0), oklch(0.72 0 0));
  --state-unstarted: light-dark(oklch(0.5 0.06 250), oklch(0.75 0.06 250));
  --state-started: light-dark(oklch(0.52 0.15 250), oklch(0.78 0.13 250));
  --state-completed: light-dark(oklch(0.52 0.15 150), oklch(0.78 0.14 150));
  --state-canceled: light-dark(oklch(0.5 0.03 25), oklch(0.72 0.03 25));
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body {
  margin: 0;
  font-family: var(--font-sans);
  color: var(--color-text-primary);
  background: transparent;
  font-size: var(--font-text-md-size);
  line-height: var(--font-text-md-line-height);
  /* The card reflows against the width it is actually given, not the viewport. A widget has no
     idea how wide the transcript around it is, and on a phone that is 320px. */
  container-type: inline-size;
}

/* The four ways a card can be, exactly one at a time. */
body[data-state='loading'] .content,
body[data-state='stalled'] .content,
body[data-state='error'] .content { display: none; }
body[data-state='ready'] .skeleton,
body[data-state='error'] .skeleton { display: none; }

/* Every widget's own markup renders in here, so this is what has to space it. The card's gap only
   ever separated the skeleton, the status line and this wrapper — a widget's own children got
   nothing, which is why an action bar sat against the text above it. */
.content { display: flex; flex-direction: column; gap: 12px; }

.skeleton { display: flex; flex-direction: column; gap: 8px; }
.sk { background: var(--color-background-secondary); border-radius: var(--border-radius-md); }
.sk-headline { height: 0.9375rem; width: 42%; }
.sk-row { height: 1.75rem; }
@media (prefers-reduced-motion: no-preference) {
  .sk { animation: sk-pulse 1.4s ease-in-out infinite; }
}
@keyframes sk-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }

.status { margin: 0; color: var(--color-text-secondary); }
.status[data-tone='error'] { color: var(--color-text-danger); }

/* Every measurement on this card comes off the same 4px scale the Stack and Row primitives close
   over: 0, 4, 8, 12, 16, 24, 32. The 14px inset and 10px stack gap were on no scale at all. */
.card {
  border: 1px solid var(--color-border-primary);
  border-radius: var(--border-radius-lg);
  background: var(--color-background-primary);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.headline {
  font-size: var(--font-heading-xs-size);
  line-height: var(--font-heading-xs-line-height);
  font-weight: var(--font-weight-semibold);
}
.muted { color: var(--color-text-secondary); }
/* A restatement of the query, not a title. It sits above the list to be checked and then ignored,
   so it takes the caption weight rather than competing with the rows for first read. */
.headline.scope {
  color: var(--color-text-secondary);
  font-size: var(--font-text-sm-size);
  line-height: var(--font-text-sm-line-height);
  font-weight: var(--font-weight-medium);
}

/* Entity documents have their own rhythm. Facts, prose, related work, and batch results are
   different kinds of information; the generic row utility below is deliberately not their
   layout system. */
.entity-header { display: grid; gap: 6px; }
.entity-kicker {
  font-size: var(--font-text-sm-size);
  line-height: var(--font-text-sm-line-height);
  font-weight: var(--font-weight-medium);
}
.entity-title {
  margin: 0;
  font-size: 1.25rem;
  line-height: 1.25;
  letter-spacing: -0.015em;
  font-weight: var(--font-weight-semibold);
}
.entity-narrative,
.entity-section-narrative { margin: 0; max-width: 68ch; line-height: 1.55; }
.entity-context { display: flex; flex-wrap: wrap; gap: 6px; padding-top: 2px; }
.entity-context-item {
  padding: 3px 8px;
  border-radius: var(--border-radius-full);
  background: var(--color-background-secondary);
  color: var(--color-text-secondary);
  font-size: var(--font-text-sm-size);
  line-height: var(--font-text-sm-line-height);
}
.entity-facts { display: grid; grid-template-columns: minmax(6rem, 0.35fr) minmax(0, 1fr); gap: 6px 16px; }
.entity-fact { display: contents; }
.entity-fact-label { color: var(--color-text-secondary); }
.entity-fact-value { min-width: 0; font-weight: var(--font-weight-medium); }
.entity-sections { display: grid; gap: 18px; }
.entity-section { display: grid; gap: 8px; }
.entity-section-title {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-text-sm-size);
  line-height: var(--font-text-sm-line-height);
  font-weight: var(--font-weight-semibold);
}
.entity-preview-list { display: grid; gap: 6px; }
.entity-preview {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 9px 10px;
  border-radius: var(--border-radius-md);
  background: var(--color-background-secondary);
}
.entity-preview-copy,
.batch-copy { min-width: 0; flex: 1 1 auto; }
.entity-preview-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: var(--font-weight-medium); }
.batch-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-text-md-size);
  line-height: var(--font-text-md-line-height);
  font-weight: var(--font-weight-semibold);
}
.entity-preview-secondary,
.batch-context { margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--font-text-sm-size); line-height: var(--font-text-sm-line-height); }
.batch-meta { margin-top: 5px; font-size: var(--font-text-sm-size); line-height: var(--font-text-sm-line-height); }
.entity-preview-action { flex: 0 0 auto; }
.batch-list { display: grid; gap: 8px; }
.batch-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border-radius: var(--border-radius-md);
  background: var(--color-background-secondary);
}
.batch-action { min-height: 2rem; }
/* A list, not a stack of chips and not a ruled table. Every row used to be a filled rounded
   rectangle, which gave five rows five competing edges and no reading order, and left no room for
   anything under the title. Spacing does the separating — the design system bans a border drawn for
   grouping (§8) — so the rhythm carries it: 2px holds a title to its own facts, 12px holds one row
   off the next, and the eye groups on the difference. */
.rows { display: flex; flex-direction: column; gap: 12px; }
.row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  /* No column gap. The glyph column is auto-sized and collapses to nothing on a card that has no
     glyphs, but a column *gap* does not collapse with it — every row on the change report sat
     10px right of its own headline for a track that was not there. The glyph pays for its own
     spacing instead. */
  column-gap: 0;
  row-gap: 4px;
}
/* Indentation already groups a tree, so its rows sit closer than a flat list's. */
.rows.tree { gap: 8px; }
/* A height in real units, matching the title's line box, so the glyph centres on the first line
   rather than on the whole row. A unitless line-height is a number, not a length, and as a height
   it is simply dropped. */
.row .glyph {
  grid-row: 1;
  height: 1.25rem;
  align-items: center;
  margin-right: 8px;
}
.row .name {
  grid-column: 2;
  font-weight: var(--font-weight-medium);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* The second line under a title: where it lives, who owns it, when it lands, or what changed.
   Wraps rather than truncates, because the fact that gets cut is the one the reader needed. */
.row .facts,
.row .changes {
  grid-column: 2;
  color: var(--color-text-secondary);
  font-size: var(--font-text-sm-size);
  line-height: var(--font-text-sm-line-height);
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.row .facts {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 4px;
}
.row .facts .sep { opacity: 0.5; }
/* Late is the one thing on a card worth colour. */
.row .facts .late { color: var(--color-text-danger); font-weight: var(--font-weight-medium); }
/* Sized to the line it sits beside, not to the button metrics: it is invisible until hover, and a
   26px control in a 20px row silently set the height of every row on the card. */
/* Row 1, not spanning. Spanning two rows made the grid materialise a second row on every card,
   including the single-line ones, and charged each of them its row-gap for a row holding nothing. */
.row .open {
  grid-column: 3;
  grid-row: 1;
  align-self: center;
  margin-left: 8px;
  padding: 0 8px;
  font-size: var(--font-text-sm-size);
  line-height: var(--font-text-md-line-height);
  opacity: 0;
}
.row:hover .open,
.row .open:focus-visible { opacity: 1; }
/* Touch has no hover, so the affordance cannot hide behind one. */
@media (hover: none) {
  .row .open { opacity: 1; }
}
/* Changed fields, one per line. Packing them onto one line meant only the first could show its
   values and the rest were named without them. */
.row .changes {
  display: grid;
  grid-template-columns: minmax(4rem, auto) minmax(0, 1fr);
  gap: 0 12px;
  margin: 0;
}
.row .changes dd { margin: 0; }
.row .changes .from,
.row .changes .was { text-decoration: line-through; }
.row .changes .to { color: var(--color-text-primary); font-weight: var(--font-weight-medium); }
.head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
/* The remainder, when the host cannot expand the card. Aligned with the rows above it rather than
   with the card edge, because it is the last entry in the list and not a footer. */
.rest { align-self: flex-start; padding: 4px 0; text-align: left; }

/* Fullscreen is the one place a card may scroll: it is no longer sitting in the transcript flow,
   so a scroll region here traps nothing. The card loses its own frame because the host is now
   drawing one around the whole surface. */
body[data-display-mode='fullscreen'] { height: 100vh; }
body[data-display-mode='fullscreen'] .card {
  height: 100vh;
  border: 0;
  border-radius: 0;
}
body[data-display-mode='fullscreen'] .rows {
  flex: 1 1 auto;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.skipped .name { color: var(--color-text-secondary); }
/* Reconciled, not created. Present because it is the proof the call did not duplicate anything,
   and dimmed because it is not what changed. */
.row.matched .name { color: var(--color-text-secondary); font-weight: var(--font-weight-normal); }
.reason {
  grid-column: 2;
  color: var(--color-text-danger);
  font-size: var(--font-text-sm-size);
  line-height: var(--font-text-sm-line-height);
}
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
button {
  font: inherit;
  /* 8px horizontal is the design system's floor for every control step, so no control renders text
     flush against its own edge. */
  padding: 4px 12px;
  border-radius: var(--border-radius-md);
  border: 1px solid var(--color-border-primary);
  background: var(--color-background-primary);
  color: var(--color-text-primary);
  cursor: pointer;
}
button:hover { background: var(--color-background-secondary); }
button:disabled { opacity: 0.5; cursor: default; }
button:focus-visible { outline: 2px solid var(--color-ring-primary); outline-offset: 2px; }

/* One bordered action per card and the rest quiet. Filling a button would mean choosing a
   foreground against a host-supplied colour whose contrast nobody here can check. */
button.quiet {
  border-color: transparent;
  background: transparent;
  color: var(--color-text-secondary);
}
button.quiet:hover { background: var(--color-background-secondary); color: var(--color-text-primary); }

/* The two edits someone makes with the card in front of them. Native select and date input on
   purpose: they open the host's own picker outside this frame, they are keyboard-operable and
   labelled for free, and an inline widget must not open a popover of its own inside someone
   else's transcript. */
.edits { display: flex; flex-wrap: wrap; gap: 8px; }
.field { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.field-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--color-text-secondary);
  font-size: var(--font-text-sm-size);
}
select,
input[type='date'] {
  font: inherit;
  min-height: 1.75rem;
  padding: 3px 8px;
  border-radius: var(--border-radius-md);
  border: 1px solid var(--color-border-primary);
  background: var(--color-background-primary);
  color: var(--color-text-primary);
  max-width: 100%;
}
select:focus-visible,
input[type='date']:focus-visible {
  outline: 2px solid var(--color-ring-primary);
  outline-offset: 2px;
}
select:disabled,
input[type='date']:disabled { opacity: 0.5; }

/* Names the block below it. A group of rows with no heading reads as more of the same thing,
   which for skipped work is the opposite of true. */
.group-label {
  color: var(--color-text-secondary);
  font-size: var(--font-text-sm-size);
  line-height: var(--font-text-sm-line-height);
  font-weight: var(--font-weight-medium);
}
.empty { color: var(--color-text-secondary); }

/* A tick is the one control someone taps rather than clicks, so it carries a real target even
   though the glyph inside it is small. */
.tick {
  flex: 0 0 auto;
  width: 1.75rem;
  height: 1.75rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  line-height: 1;
}
.tick[aria-checked='true'] { color: var(--color-text-success); }
.row .name.done { text-decoration: line-through; color: var(--color-text-secondary); }

/* The state glyph is the one piece of this card that is unmistakably Docket, so it renders at the
   product's 16px icon floor rather than shrinking to fit a dense row. */
.glyph { flex: 0 0 auto; display: inline-flex; width: 1rem; height: 1rem; }
.glyph svg { width: 1rem; height: 1rem; display: block; }
.state-backlog { color: var(--state-backlog); }
.state-unstarted { color: var(--state-unstarted); }
.state-started { color: var(--state-started); }
.state-completed { color: var(--state-completed); }
.state-canceled { color: var(--state-canceled); }

@container (max-width: 380px) {
  /* Below this the title and its diff cannot share a line without one of them becoming unreadable.
     Stacking is a decision; ellipsising a title down to "LV…" is an accident. */
  .row { flex-direction: column; align-items: stretch; gap: 2px; }
  .row .name { white-space: normal; overflow: visible; text-overflow: clip; }
  .row:has(.tick) { flex-direction: row; align-items: center; }
  .tick { width: 2.5rem; height: 2.5rem; }
  .actions button { flex: 1 1 auto; min-height: 2.5rem; }
  .field { width: 100%; }
  .field select,
  .field input[type='date'] { flex: 1 1 auto; min-height: 2.5rem; }
  .entity-title { font-size: 1.125rem; }
  .entity-facts { grid-template-columns: 1fr; gap: 2px; }
  .entity-fact { display: grid; gap: 1px; padding-block: 5px; }
  .entity-preview,
  .batch-item { align-items: stretch; grid-template-columns: 1fr; gap: 8px; }
  .entity-preview-title,
  .entity-preview-secondary,
  .batch-title,
  .batch-context { overflow: visible; text-overflow: clip; white-space: normal; }
  .entity-preview-action,
  .batch-action { width: 100%; min-height: 2.5rem; }
}
`;
