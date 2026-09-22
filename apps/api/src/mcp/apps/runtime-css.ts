/**
 * `@docket/api` — the stylesheet every Docket MCP App card shares.
 *
 * @remarks
 * The structure is Docket's; the skin is the host's. Every colour, radius, type size, weight and
 * family is read from a variable the MCP Apps specification standardises
 * (`McpUiStyleVariableKey`), which is what a host supplies so an app looks native inside it. The
 * `:root` values are only fallbacks for a host that supplies some variables or none. Two things
 * stay Docket's own because the specification has no word for them: the workflow-state colours
 * (`--state-*`) and spacing, which sits on Docket's 4px scale.
 *
 * The host draws the card's frame (the resources declare `prefersBorder: true`), so `.card` has no
 * border or background of its own. Inside it, structure is carried by tonal steps and never by a
 * rule: a section is a `--color-background-secondary` container, a row is marked by its leading
 * anchor and tinted on hover, and the type ladder has four levels — title, section label, row
 * title, meta — and nothing in between.
 *
 * The `:root` values are literals, never `var(--x, …)` self-references. A custom property that
 * references itself is a cycle, and CSS resolves cycles to guaranteed-invalid before it would
 * reach the fallback. `mcp-apps-tokens.test.ts` checks every name here against the vendored spec.
 *
 * Inline cards never scroll: they sit inside someone else's transcript, and a nested scroll region
 * there is a trap. Fullscreen is the one place the card scrolls.
 */
export const RUNTIME_CSS = String.raw`
:root {
  color-scheme: light dark;

  --color-background-primary: light-dark(#ffffff, #1c1c20);
  --color-background-secondary: light-dark(#f4f4f6, #26262c);
  --color-background-tertiary: light-dark(#e8e8ec, #303038);
  --color-background-success: light-dark(#e6f4ea, #16301f);
  --color-background-warning: light-dark(#fcf1dc, #362a12);
  --color-background-danger: light-dark(#fce8e6, #3a1c1a);
  --color-text-primary: light-dark(#18181b, #f2f2f4);
  --color-text-secondary: light-dark(#52525b, #b1b1bd);
  --color-text-tertiary: light-dark(#6b6b76, #9595a1);
  --color-text-info: light-dark(#1d4ed8, #8ab0f8);
  --color-text-danger: light-dark(#b42318, #f9a8a0);
  --color-text-success: light-dark(#15803d, #7fd6a0);
  --color-text-warning: light-dark(#8f5300, #f3c46b);
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
  --font-heading-sm-size: 1.125rem;
  --font-heading-sm-line-height: 1.3;

  --border-radius-xs: 3px;
  --border-radius-sm: 4px;
  --border-radius-md: 6px;
  --border-radius-lg: 10px;
  --border-radius-full: 999px;

  /* Workflow-state colours, which the extension standardizes no vocabulary for. Docket's own
     --state-* ramp verbatim, so a card in a foreign host still reads in Docket's state language.
     See WIDGET_OWNED in mcp-apps-tokens.test.ts. */
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
  /* The card reflows against the width it is given, not the viewport: on a phone that is 320px. */
  container-type: inline-size;
}

/* The four ways a card can be, exactly one at a time. */
body[data-state='loading'] .content,
body[data-state='stalled'] .content,
body[data-state='error'] .content { display: none; }
body[data-state='ready'] .skeleton,
body[data-state='error'] .skeleton { display: none; }

.card { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.content { display: flex; flex-direction: column; gap: 8px; }
.skeleton { display: flex; flex-direction: column; gap: 8px; }
.sk { background: var(--color-background-secondary); border-radius: var(--border-radius-md); }
.sk-headline { height: 1rem; width: 42%; }
.sk-row { height: 2.25rem; }
@media (prefers-reduced-motion: no-preference) {
  .sk { animation: sk-pulse 1.4s ease-in-out infinite; }
}
@keyframes sk-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
.status { margin: 0; color: var(--color-text-secondary); }
.status[data-tone='error'] { color: var(--color-text-danger); }

/* Header: what this is, what it is called, the facts that qualify it, and its one action. */
.head { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; align-items: start; }
.kicker {
  grid-column: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text-secondary);
  font-size: var(--font-text-sm-size);
  line-height: var(--font-text-sm-line-height);
  font-weight: var(--font-weight-medium);
}
.title {
  grid-column: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: var(--font-heading-sm-size);
  line-height: var(--font-heading-sm-line-height);
  font-weight: var(--font-weight-semibold);
  overflow-wrap: anywhere;
}
.head-actions { grid-column: 2; grid-row: 1 / span 2; display: flex; gap: 4px; }
.chips { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 4px; padding-top: 4px; }
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: var(--border-radius-full);
  background: var(--color-background-secondary);
  color: var(--color-text-secondary);
  font-size: var(--font-text-sm-size);
  line-height: var(--font-text-sm-line-height);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.chip .dot { width: 8px; height: 8px; border-radius: var(--border-radius-full); background: currentColor; }
.chip[data-tone='success'] { color: var(--color-text-success); background: var(--color-background-success); }
.chip[data-tone='warning'] { color: var(--color-text-warning); background: var(--color-background-warning); }
.chip[data-tone='danger'] { color: var(--color-text-danger); background: var(--color-background-danger); }
.lede {
  grid-column: 1 / -1;
  margin: 4px 0 0;
  color: var(--color-text-secondary);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}
body[data-display-mode='fullscreen'] .lede { -webkit-line-clamp: unset; display: block; }

/* Section: a tonal container that names its contents and counts them. */
.section {
  display: flex;
  flex-direction: column;
  padding: 4px;
  border-radius: var(--border-radius-lg);
  background: var(--color-background-secondary);
}
.section-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 32px; padding: 0 4px 0 8px; }
.section-label {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-text-sm-size);
  line-height: var(--font-text-sm-line-height);
  font-weight: var(--font-weight-semibold);
}
.section-count { font-weight: var(--font-weight-normal); color: var(--color-text-tertiary); font-variant-numeric: tabular-nums; }
.section-body { display: flex; flex-direction: column; }
.section-foot { display: flex; padding: 0 4px 4px; }
.section > .prose:first-child,
.section > .section-body:first-child > .prose:first-child { padding-top: 8px; }

/* Row: an anchor column the eye runs down, a title, its facts, and a trailing value or action. */
.row {
  position: relative;
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) auto;
  column-gap: 12px;
  align-items: start;
  min-height: 36px;
  padding: 8px;
  border-radius: var(--border-radius-md);
}
.row:hover { background: var(--color-background-tertiary); }
.row-anchor {
  grid-column: 1;
  grid-row: 1;
  display: flex;
  align-items: center;
  height: calc(var(--font-text-md-size) * var(--font-text-md-line-height));
  color: var(--color-text-secondary);
}
.row-title {
  grid-column: 2;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: var(--font-weight-medium);
}
.row-meta,
.row-note {
  grid-column: 2;
  color: var(--color-text-secondary);
  font-size: var(--font-text-sm-size);
  line-height: var(--font-text-sm-line-height);
}
.row-meta { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 4px; font-variant-numeric: tabular-nums; }
.row-meta .sep { color: var(--color-text-tertiary); }
.row-note { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.row .avatar { width: 20px; height: 20px; margin: -2px; font-size: 0.625rem; }
.row-trailing {
  grid-column: 3;
  grid-row: 1;
  display: flex;
  align-items: center;
  gap: 4px;
  height: calc(var(--font-text-md-size) * var(--font-text-md-line-height));
  color: var(--color-text-secondary);
  font-size: var(--font-text-sm-size);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
/* A row that opens something is itself the target. Its Open button is the pointer's hint, laid
   over the trailing edge on hover so it never takes width from the title. Touch has no hover, and
   the row is already the target, so the button is not drawn there. */
.row[data-href] { cursor: pointer; }
.row[data-href]:focus-visible { outline: 2px solid var(--color-ring-primary); outline-offset: -2px; }
.row .open { position: absolute; top: 6px; right: 6px; opacity: 0; background: var(--color-background-primary); }
.row:hover .open,
.row:focus-visible .open { opacity: 1; }
@media (hover: none) { .row .open { display: none; } }
.row.dim .row-title { color: var(--color-text-secondary); font-weight: var(--font-weight-normal); }
.row.done .row-title { color: var(--color-text-secondary); text-decoration: line-through; }
.late { color: var(--color-text-danger); font-weight: var(--font-weight-medium); }
.reason { color: var(--color-text-danger); }
.empty { padding: 8px; color: var(--color-text-secondary); }

.icon { flex: 0 0 auto; display: inline-flex; width: 16px; height: 16px; }
.icon svg,
.glyph svg { width: 16px; height: 16px; display: block; }
.glyph { flex: 0 0 auto; display: inline-flex; width: 16px; height: 16px; }
.state-backlog { color: var(--state-backlog); }
.state-unstarted { color: var(--state-unstarted); }
.state-started { color: var(--state-started); }
.state-completed { color: var(--state-completed); }
.state-canceled { color: var(--state-canceled); }
.tone-success { color: var(--color-text-success); }
.tone-warning { color: var(--color-text-warning); }
.tone-danger { color: var(--color-text-danger); }

/* Prose: authored writing, drawn from the server's block model. Its headings sit below the card
   title on the ladder, so a brief never outranks the thing it belongs to. */
.prose { position: relative; padding: 4px 8px 8px; line-height: 1.55; overflow-wrap: anywhere; }
.prose :is(p, h3, h4, h5, ul, ol, blockquote, pre, table) { margin: 0; }
.prose > * + *,
.prose .quote > * + *,
.prose li > div > * + * { margin-top: 8px; }
.prose .h1,
.prose .h2 { font-weight: var(--font-weight-semibold); }
.prose > .h1:not(:first-child),
.prose > .h2:not(:first-child) { margin-top: 16px; }
.prose .h3 { font-weight: var(--font-weight-medium); color: var(--color-text-secondary); }
.prose ul,
.prose ol { padding-left: 20px; }
.prose li + li { margin-top: 4px; }
.prose li.task { list-style: none; display: grid; grid-template-columns: 16px minmax(0, 1fr); gap: 8px; margin-left: -20px; }
.prose li.task .glyph { margin-top: calc((1.55em - 16px) / 2); }
.prose li.task.checked > div { color: var(--color-text-secondary); text-decoration: line-through; }
.prose .quote { padding: 8px 12px; border-radius: var(--border-radius-md); background: var(--color-background-tertiary); }
.prose pre {
  padding: 8px 12px;
  border-radius: var(--border-radius-md);
  background: var(--color-background-tertiary);
  font-family: var(--font-mono);
  font-size: var(--font-text-sm-size);
  white-space: pre-wrap;
}
.prose code { font-family: var(--font-mono); font-size: 0.9em; padding: 0 4px; border-radius: var(--border-radius-xs); background: var(--color-background-tertiary); }
.prose pre code { padding: 0; background: none; }
.prose a { color: var(--color-text-info); text-underline-offset: 2px; cursor: pointer; }
.prose .gap { height: 4px; }
.prose table { width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 0 2px; font-size: var(--font-text-sm-size); }
.prose th { text-align: left; color: var(--color-text-secondary); font-weight: var(--font-weight-semibold); }
.prose th,
.prose td { padding: 4px 8px; vertical-align: top; }
.prose td { background: var(--color-background-tertiary); }
.prose h3,
.prose h4,
.prose h5 { font-size: inherit; line-height: inherit; }
/* The clamp height is set inline from a line count; fullscreen lifts it. */
.prose[data-clamp] { overflow: hidden; }
.prose[data-clamp='fade'] { mask-image: linear-gradient(to bottom, black 65%, transparent); }
body[data-display-mode='fullscreen'] .prose[data-clamp] { max-height: none !important; mask-image: none; }

/* A field that changed: its name, then what it was and what it is now. */
.changes { grid-column: 2; display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 12px; margin: 4px 0 0; font-size: var(--font-text-sm-size); line-height: var(--font-text-sm-line-height); }
.changes dt { color: var(--color-text-secondary); }
.changes dd { margin: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px; min-width: 0; }
.was { color: var(--color-text-secondary); text-decoration: line-through; }
.now { font-weight: var(--font-weight-medium); }
.excerpt { color: var(--color-text-secondary); }
.excerpt.full { flex-basis: 100%; }
.section-body > .changes { padding: 4px 8px 8px; }
.excerpt del { color: var(--color-text-danger); background: var(--color-background-danger); border-radius: var(--border-radius-xs); }
.excerpt ins { color: var(--color-text-success); background: var(--color-background-success); border-radius: var(--border-radius-xs); text-decoration: none; }

/* Inline properties: one row of compact editors, each a tonal pill led by its icon. */
.props-bar { display: flex; flex-wrap: wrap; gap: 8px; }
.prop-pill { display: inline-flex; align-items: center; gap: 6px; padding: 2px 4px 2px 10px; border-radius: var(--border-radius-full); background: var(--color-background-secondary); }
.prop-pill select,
.prop-pill input[type='date'] { background: transparent; min-height: 28px; padding: 2px 4px; }
.prop-pill:focus-within { outline: 2px solid var(--color-ring-primary); outline-offset: 2px; }
.prop-pill select:focus-visible,
.prop-pill input[type='date']:focus-visible { outline: none; }

/* Properties: one working editor per row, label and control on the row's own grid. */
.prop { display: grid; grid-template-columns: 16px minmax(5rem, max-content) minmax(0, 1fr); column-gap: 12px; align-items: center; min-height: 40px; padding: 4px 8px; }
.prop .row-anchor { height: auto; }
.prop-label { color: var(--color-text-secondary); }
.prop-control { display: flex; align-items: center; gap: 8px; min-width: 0; }

button {
  font: inherit;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 28px;
  padding: 2px 8px;
  border: 0;
  border-radius: var(--border-radius-md);
  background: transparent;
  color: var(--color-text-secondary);
  font-size: var(--font-text-sm-size);
  cursor: pointer;
  white-space: nowrap;
}
button:hover { background: var(--color-background-tertiary); color: var(--color-text-primary); }
button.tonal { background: var(--color-background-secondary); color: var(--color-text-primary); font-weight: var(--font-weight-medium); padding: 2px 12px; }
button.tonal:hover { background: var(--color-background-tertiary); }
button:disabled { opacity: 0.5; cursor: default; }
button:focus-visible,
select:focus-visible,
input:focus-visible { outline: 2px solid var(--color-ring-primary); outline-offset: 2px; }
select,
input[type='date'] {
  font: inherit;
  min-height: 32px;
  max-width: 100%;
  padding: 2px 8px;
  border: 0;
  border-radius: var(--border-radius-md);
  background: var(--color-background-primary);
  color: var(--color-text-primary);
}
select:disabled,
input[type='date']:disabled { opacity: 0.5; }
.tick { flex: 0 0 auto; width: 16px; height: 16px; min-height: 0; padding: 0; justify-content: center; color: var(--color-text-secondary); }
.tick:hover { background: none; color: var(--color-text-primary); }
.tick[aria-checked='true'] { color: var(--state-completed); }

/* A receipt reports an action: a status glyph, what happened in one line, and where it landed. It
   carries no kind and no title, because it describes an event rather than a thing. */
.receipt { display: grid; grid-template-columns: 24px minmax(0, 1fr); column-gap: 12px; align-items: start; }
.receipt-glyph { display: flex; align-items: center; justify-content: center; height: calc(var(--font-text-md-size) * var(--font-text-md-line-height)); }
.receipt-glyph .glyph,
.receipt-glyph .icon,
.receipt-glyph svg { width: 20px; height: 20px; }
.receipt-summary { margin: 0; font-weight: var(--font-weight-semibold); overflow-wrap: anywhere; }
.receipt-detail { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin-top: 4px; color: var(--color-text-secondary); font-size: var(--font-text-sm-size); }
button.place { background: var(--color-background-secondary); color: var(--color-text-primary); font-weight: var(--font-weight-medium); border-radius: var(--border-radius-full); padding: 2px 8px 2px 6px; white-space: normal; text-align: left; }
button.place:hover { background: var(--color-background-tertiary); }
button.place .icon:last-child { width: 14px; height: 14px; color: var(--color-text-secondary); }
button .icon svg { width: 16px; height: 16px; }
.card-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.note { margin: 0; padding: 4px 8px 8px; color: var(--color-text-secondary); font-size: var(--font-text-sm-size); }

/* A breakdown: how the work divides across the board's states, each a tonal count that filters. */
.breakdown { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 8px 8px; }
.breakdown .chip { gap: 6px; }
.breakdown button.chip { min-height: 0; cursor: pointer; }
.breakdown button.chip:hover { background: var(--color-background-tertiary); color: var(--color-text-primary); }
.breakdown .chip .glyph,
.breakdown .chip .glyph svg { width: 14px; height: 14px; }

/* Tabs, search, and filter chips: the controls a browsing view is made of. */
.browse { display: flex; flex-direction: column; gap: 8px; padding: 4px 4px 8px; }
.browse-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.tabs-holder { display: contents; }
.tabs { display: flex; flex-wrap: wrap; gap: 4px; }
button.tab { background: transparent; color: var(--color-text-secondary); border-radius: var(--border-radius-full); padding: 2px 10px; }
button.tab[aria-pressed='true'] { background: var(--color-background-secondary); color: var(--color-text-primary); font-weight: var(--font-weight-medium); }
/* A view switch is a segmented control: a tonal track with the chosen view lifted out of it, so it
   reads as where you are rather than as one more filter. */
.tabs.segmented { align-self: flex-start; gap: 2px; padding: 2px; border-radius: var(--border-radius-full); background: var(--color-background-secondary); }
.tabs.segmented button.tab[aria-pressed='true'] { background: var(--color-background-primary); }
.tab-count { color: var(--color-text-tertiary); font-variant-numeric: tabular-nums; }
.search { display: flex; align-items: center; gap: 6px; flex: 1 1 12rem; min-width: 0; padding: 0 8px; border-radius: var(--border-radius-md); background: var(--color-background-primary); color: var(--color-text-secondary); }
.search input { flex: 1 1 auto; min-width: 0; min-height: 32px; border: 0; background: transparent; color: var(--color-text-primary); font: inherit; outline: none; }
.search:focus-within { outline: 2px solid var(--color-ring-primary); outline-offset: 2px; }
.chip.filter { background: var(--color-background-primary); color: var(--color-text-primary); padding-right: 2px; }
.chip.filter .icon,
.chip.filter .icon svg { width: 14px; height: 14px; }
button.chip-clear { min-height: 0; padding: 2px; border-radius: var(--border-radius-full); }

/* An update reads as something a person posted: who, when, how it stands, then what they wrote on
   its own lifted surface. */
.post { display: flex; flex-direction: column; gap: 4px; padding: 12px; border-radius: var(--border-radius-md); background: var(--color-background-primary); }
.post-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
.post-author { font-weight: var(--font-weight-medium); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.post-when { color: var(--color-text-secondary); font-size: var(--font-text-sm-size); white-space: nowrap; }
.post-head .chip { margin-left: auto; }
.post .prose { padding: 0; }
.post .section-foot { padding: 0; }
/* A text action under prose starts where the prose starts, not where its own padding does. */
.clamped .section-foot button { margin-left: -8px; }
.section-body > .clamped > .section-foot { padding: 0 8px 4px; }
.avatar { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: var(--border-radius-full); background: var(--color-background-tertiary); color: var(--color-text-secondary); font-size: 0.6875rem; font-weight: var(--font-weight-semibold); }
.tone-info { color: var(--color-text-info); }

button.icon-only { padding: 4px; min-width: 28px; justify-content: center; }

/* A card taller than the room its host gave it: cut to that height, and a pinned way into
   fullscreen where the rest fits. The content fades out through a mask, so the host's own frame
   shows through the fade whatever colour it is. */
.card.clipped { position: relative; overflow: hidden; }
.card.clipped > .content {
  min-height: 0;
  overflow: hidden;
  -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 96px), transparent calc(100% - 40px));
  mask-image: linear-gradient(to bottom, #000 calc(100% - 96px), transparent calc(100% - 40px));
}
.clip-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  justify-content: center;
  padding: 12px;
}

body[data-display-mode='fullscreen'] { height: 100vh; }
body[data-display-mode='fullscreen'] .card { height: 100vh; overflow-y: auto; overscroll-behavior: contain; }

@media (pointer: coarse) {
  button,
  select,
  input[type='date'] { min-height: 40px; }
  .tick { width: 40px; height: 40px; margin: -12px; }
}
@container (max-width: 380px) {
  /* The actions share the kind's line, and the title takes the full width under both. */
  .head-actions { grid-row: 1; }
  .title { grid-column: 1 / -1; }
  /* The state glyph names each count on a phone; its name stays for a screen reader. */
  .breakdown .chip-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  /* A row's trailing value moves under its title, so the title keeps the width. */
  .row-trailing { grid-column: 2; grid-row: auto; height: auto; }
  .row-title { white-space: normal; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
  .prop { grid-template-columns: 16px minmax(0, 1fr); row-gap: 4px; }
  .prop-control { grid-column: 1 / -1; }
  .prop-control select,
  .prop-control input[type='date'] { flex: 1 1 auto; }
}
`;
