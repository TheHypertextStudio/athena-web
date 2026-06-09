# Docket — Design System & App Shell Implementation Spec

> **Area:** `design-system` · **Owner package:** `@docket/ui` (+ `tooling/tailwind-config`)
> **Source of truth:** `docs/core/mvp-plan.md` (product), `docs/engineering/docket-engineering-plan.md` (model/stack). This spec must not contradict them.
> **Verified against current docs (2026‑06‑05):** Tailwind CSS v4 `@theme` / `@theme inline` / `@custom-variant`, OKLCH color space, shadcn/ui `new-york` style + `components.json` for Tailwind v4 (no `tailwind.config`, `cssVariables: true`, `tw-animate-css` plugin), lucide icons. Next.js 16 / React 19 (React Compiler on).
>
> **Design north star:** Linear‑grade — calm, dense, fast, keyboard‑first, monochrome surfaces with restrained accent + semantic color. **Domain‑neutral**: nothing in the visual language reads as a "developer tool." Org context is conveyed by a single org chip/tint, never by chrome that screams "engineering."

---

## 0. Scope, package layout, and contracts

### 0.1 What lives where

| Concern                                           | Location                                                                                                               | Build mode               |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Tokens (CSS), Tailwind preset, globals            | `tooling/tailwind-config/` (`globals.css`, `preset.ts` not used in v4 — see §1) + re‑exported from `@docket/ui/styles` | JIT (raw TS/CSS)         |
| `components.json` per app                         | `apps/web/`, `apps/marketing/`, `apps/admin/`                                                                          | n/a                      |
| Primitive shadcn components (vendored)            | `@docket/ui/src/primitives/*` (the shadcn `ui/` output)                                                                | JIT, `transpilePackages` |
| Docket custom components (view primitives, shell) | `@docket/ui/src/components/*`                                                                                          | JIT, `transpilePackages` |
| Hooks (keyboard, density, vocab)                  | `@docket/ui/src/hooks/*`                                                                                               | JIT                      |
| Icon set                                          | `lucide-react` (re‑exported via `@docket/ui/icons`)                                                                    | JIT                      |

Per the engineering plan §1, `@docket/ui` is **Just‑in‑Time** (raw TS + `transpilePackages` in each Next app), never compiled to `dist`. Keep the Tailwind content globs pointed at `@docket/ui/src/**`.

### 0.2 Hard constraints inherited

- **No legacy APIs.** Tailwind **v4 only** (CSS‑first config via `@theme`; **no `tailwind.config.js`**). shadcn **`new-york`** style, **`cssVariables: true`**, base color **`neutral`**. Animations via **`tw-animate-css`** (not the deprecated `tailwindcss-animate`). React 19 + React Compiler (so memoization helpers are largely unnecessary — do **not** hand‑write `memo`/`useMemo` for perf unless profiled).
- **Env‑var‑only / dev‑mirrors‑prod:** the design system has no runtime env dependency; theme is resolved client‑side from `class="dark"` + a persisted preference. No build‑time theme switches.
- **Accessibility:** WCAG 2.2 AA. All interactive primitives keyboard‑reachable; visible focus ring; `prefers-reduced-motion` honored (also used by the Playwright film runs at reduced motion per eng plan §6).

### 0.3 The two cross‑cutting design contracts

Two product rules touch every component and are implemented once, centrally:

1. **Vocabulary skin** (product §7, §8.7; model `Organization.vocabulary`). Every user‑facing label for a model entity routes through a `useVocabulary()` resolver. Components **never** hardcode "Project" / "Program" / "Initiative" / "Cycle" / "Team" / "Milestone" / "Triage". See §6.
2. **Org context tint** (product §7 "rebind", §8.1 org‑chips). The active org supplies a single accent hue used for its avatar ring, the active rail indicator, and org chips. See §1.6 + §4.

---

## 1. Design Tokens

All tokens are **CSS custom properties in OKLCH**, defined under `:root` / `.dark`, then **mapped to Tailwind utilities via `@theme inline`** (the shadcn v4 pattern). This is the single mechanism — no JS token object, no `tailwind.config`.

File: `@docket/ui/src/styles/globals.css` (imported by every app's own `globals.css`).

```css
@import 'tailwindcss';
@import 'tw-animate-css';

/* dark is a class on <html>, toggled by next-themes; no media-query auto */
@custom-variant dark (&:is(.dark *));

/* ---------------------------------------------------------------- *
 * 1. PRIMITIVE + SEMANTIC SURFACE TOKENS (light)
 * ---------------------------------------------------------------- */
:root {
  /* radius scale base (see §1.4) */
  --radius: 0.5rem;

  /* neutral surfaces — Linear-calm, near-monochrome */
  --background: oklch(1 0 0);
  --foreground: oklch(0.205 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.205 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.205 0 0);

  /* elevated app-shell surfaces (rail + sidebar sit a hair off-white) */
  --surface-1: oklch(0.985 0 0); /* sidebar / sunken panels */
  --surface-2: oklch(0.97 0 0); /* hover rows, group headers */
  --surface-3: oklch(0.94 0 0); /* pressed / selected row */
  --rail: oklch(0.205 0 0); /* the thin global rail is dark in BOTH themes */
  --rail-foreground: oklch(0.97 0 0);

  /* brand accent — restrained indigo; used sparingly (primary action, focus) */
  --primary: oklch(0.52 0.21 264);
  --primary-foreground: oklch(0.985 0 0);

  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);

  --destructive: oklch(0.577 0.245 27.325);
  --destructive-foreground: oklch(0.985 0 0);

  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.52 0.21 264); /* matches --primary */

  /* ---- SEMANTIC HEALTH (product: on_track / at_risk / off_track) ---- */
  /* These are the ONLY non-neutral hues besides --primary, used for health pills,
     update health, project/program/initiative health tints on bars. */
  --health-on-track: oklch(0.62 0.17 150); /* green */
  --health-on-track-foreground: oklch(0.99 0.01 150);
  --health-on-track-subtle: oklch(0.95 0.05 150); /* bar/chip fill bg */
  --health-at-risk: oklch(0.78 0.16 85); /* amber */
  --health-at-risk-foreground: oklch(0.28 0.07 85);
  --health-at-risk-subtle: oklch(0.96 0.07 85);
  --health-off-track: oklch(0.62 0.21 27); /* red */
  --health-off-track-foreground: oklch(0.99 0.02 27);
  --health-off-track-subtle: oklch(0.95 0.06 27);
  --health-no-update: oklch(0.7 0 0); /* neutral grey "no signal" */
  --health-no-update-subtle: oklch(0.95 0 0);

  /* ---- WORK-STATE accents (Task workflow states; muted, not loud) ----
     Maps to Team.workflow_states default {backlog,todo,in_progress,done,canceled} */
  --state-backlog: oklch(0.7 0 0); /* grey dashed ring */
  --state-todo: oklch(0.556 0 0); /* grey solid ring */
  --state-in-progress: oklch(0.78 0.16 85); /* amber partial */
  --state-done: oklch(0.62 0.17 150); /* green */
  --state-canceled: oklch(0.7 0 0); /* grey strike */

  /* ---- PRIORITY accents (Task.priority none|urgent|high|medium|low) ---- */
  --priority-urgent: oklch(0.62 0.21 27); /* red */
  --priority-high: oklch(0.62 0.05 264);
  --priority-medium: oklch(0.65 0.04 264);
  --priority-low: oklch(0.7 0.02 264);

  /* ---- AGENT / SESSION accents (sessions are first-class, product §4.1) ---- */
  --agent: oklch(0.58 0.18 295); /* violet — distinguishes agent from human */
  --agent-foreground: oklch(0.99 0.01 295);
  --session-running: oklch(0.52 0.21 264); /* primary/indigo, pulsing */
  --session-awaiting: oklch(0.78 0.16 85); /* amber — needs you */
  --session-paused: oklch(0.7 0 0);
  --session-errored: oklch(0.62 0.21 27);

  /* org accent: defaults to primary, overridden per active org (see §1.6) */
  --org-accent: var(--primary);
  --org-accent-foreground: var(--primary-foreground);

  /* data-viz ramp for timeline/roadmap & charts (categorical, color-safe) */
  --chart-1: oklch(0.62 0.19 264);
  --chart-2: oklch(0.6 0.13 200);
  --chart-3: oklch(0.65 0.15 160);
  --chart-4: oklch(0.7 0.16 85);
  --chart-5: oklch(0.64 0.2 330);
}

/* ---------------------------------------------------------------- *
 * 2. DARK THEME OVERRIDES
 * ---------------------------------------------------------------- */
.dark {
  --background: oklch(0.165 0 0);
  --foreground: oklch(0.95 0 0);
  --card: oklch(0.195 0 0);
  --card-foreground: oklch(0.95 0 0);
  --popover: oklch(0.195 0 0);
  --popover-foreground: oklch(0.95 0 0);

  --surface-1: oklch(0.195 0 0);
  --surface-2: oklch(0.225 0 0);
  --surface-3: oklch(0.26 0 0);
  --rail: oklch(0.13 0 0); /* rail darker than bg in dark mode */
  --rail-foreground: oklch(0.85 0 0);

  --primary: oklch(0.62 0.2 264);
  --primary-foreground: oklch(0.99 0 0);
  --secondary: oklch(0.26 0 0);
  --secondary-foreground: oklch(0.95 0 0);
  --muted: oklch(0.26 0 0);
  --muted-foreground: oklch(0.7 0 0);
  --accent: oklch(0.26 0 0);
  --accent-foreground: oklch(0.95 0 0);
  --destructive: oklch(0.62 0.21 27);
  --destructive-foreground: oklch(0.99 0 0);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 14%);
  --ring: oklch(0.62 0.2 264);

  --health-on-track: oklch(0.7 0.16 150);
  --health-on-track-subtle: oklch(0.3 0.06 150);
  --health-at-risk: oklch(0.8 0.15 85);
  --health-at-risk-subtle: oklch(0.32 0.07 85);
  --health-off-track: oklch(0.68 0.2 27);
  --health-off-track-subtle: oklch(0.3 0.08 27);
  --health-no-update: oklch(0.55 0 0);
  --health-no-update-subtle: oklch(0.26 0 0);

  --agent: oklch(0.68 0.17 295);
  --session-awaiting: oklch(0.8 0.15 85);
}

/* ---------------------------------------------------------------- *
 * 3. MAP TOKENS → TAILWIND UTILITIES (@theme inline = shadcn v4)
 * ---------------------------------------------------------------- */
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);

  --color-surface-1: var(--surface-1);
  --color-surface-2: var(--surface-2);
  --color-surface-3: var(--surface-3);
  --color-rail: var(--rail);
  --color-rail-foreground: var(--rail-foreground);

  --color-health-on-track: var(--health-on-track);
  --color-health-on-track-foreground: var(--health-on-track-foreground);
  --color-health-on-track-subtle: var(--health-on-track-subtle);
  --color-health-at-risk: var(--health-at-risk);
  --color-health-at-risk-foreground: var(--health-at-risk-foreground);
  --color-health-at-risk-subtle: var(--health-at-risk-subtle);
  --color-health-off-track: var(--health-off-track);
  --color-health-off-track-foreground: var(--health-off-track-foreground);
  --color-health-off-track-subtle: var(--health-off-track-subtle);
  --color-health-no-update: var(--health-no-update);
  --color-health-no-update-subtle: var(--health-no-update-subtle);

  --color-state-backlog: var(--state-backlog);
  --color-state-todo: var(--state-todo);
  --color-state-in-progress: var(--state-in-progress);
  --color-state-done: var(--state-done);
  --color-state-canceled: var(--state-canceled);

  --color-priority-urgent: var(--priority-urgent);
  --color-priority-high: var(--priority-high);
  --color-priority-medium: var(--priority-medium);
  --color-priority-low: var(--priority-low);

  --color-agent: var(--agent);
  --color-agent-foreground: var(--agent-foreground);
  --color-session-running: var(--session-running);
  --color-session-awaiting: var(--session-awaiting);
  --color-session-paused: var(--session-paused);
  --color-session-errored: var(--session-errored);

  --color-org-accent: var(--org-accent);
  --color-org-accent-foreground: var(--org-accent-foreground);

  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);

  /* radius (consumed by shadcn primitives) */
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);

  /* type families */
  --font-sans: 'Inter', 'InterVariable', ui-sans-serif, system-ui, sans-serif;
  --font-mono: 'Geist Mono', ui-monospace, 'SF Mono', monospace;
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
    font-feature-settings: 'cv11', 'ss01';
  }
  /* density: see §1.7 */
}
```

> **Why these utilities matter:** every component below references token utilities (`bg-health-at-risk-subtle text-health-at-risk`, `ring-org-accent`, `text-session-awaiting`) — never raw hex. This makes dark mode and per‑org tinting "free."

### 1.1 Color usage rules (load‑bearing)

- **Monochrome by default.** 90% of the UI is neutral (`background`, `foreground`, `muted-foreground`, `border`). Color is **earned**: only health, priority, agent/session state, and the single org accent introduce hue.
- **`on_track` = green, `at_risk` = amber, `off_track` = red, no‑update = grey** (exact mapping to `Update.health` and the `health?` field on Initiative/Program/Project). Use `*-subtle` tokens for backgrounds (pills/bars), the solid token for the dot/icon/text. Never put white text on amber `--health-at-risk` solid (use `--health-at-risk-foreground`, a dark amber).
- **Health is also encoded non‑chromatically** (icon shape + label) so it survives color‑blindness and grayscale film captures: on‑track = filled circle, at‑risk = half/triangle, off‑track = open/alert, no‑update = dashed circle.
- **The global rail is dark in both themes** (`--rail`), giving Docket a consistent "spine" — a deliberate Linear‑like signature, and keeps org avatars/badges legible regardless of theme.

### 1.2 Type scale

Inter (variable) for UI; Geist Mono for IDs/keys/timestamps/code‑adjacent. Sizes (rem, 16px root). Define as utilities via `@theme inline --text-*`:

| Token          | Size / line-height   | Weight | Use                                        |
| -------------- | -------------------- | ------ | ------------------------------------------ |
| `text-display` | 2rem / 2.4rem        | 600    | Landing/marketing only                     |
| `text-h1`      | 1.5rem / 2rem        | 600    | Page title (Detail header)                 |
| `text-h2`      | 1.25rem / 1.75rem    | 600    | Section headers                            |
| `text-h3`      | 1.0625rem / 1.5rem   | 600    | Group headers, card titles                 |
| `text-body`    | 0.875rem / 1.25rem   | 400    | **Default app text** (Linear runs at 14px) |
| `text-sm`      | 0.8125rem / 1.125rem | 400    | List rows, secondary                       |
| `text-xs`      | 0.75rem / 1rem       | 500    | Chips, badges, counts, meta                |
| `text-mono`    | 0.8125rem            | 450    | Task IDs (`ACME-128`), timestamps, scopes  |

Tracking: `-0.011em` on headings ≥ `text-h2`. Body unmodified. Numerals: `font-variant-numeric: tabular-nums` on all counts, progress %, dates, capacity.

### 1.3 Spacing

4px base unit; expose as default Tailwind spacing (Tailwind v4 already gives `--spacing` = 0.25rem). Component rhythm:

- **Row vertical padding:** comfortable `8px`, **compact `6px`**, **spacious `12px`** (density modes, §1.7).
- **Panel gutter:** `16px` (`px-4`).
- **Rail width:** `56px` fixed. **Sidebar width:** `240px` default, resizable `200–320px`, collapsible to `0`.
- **Properties panel width:** `300px` default, resizable `260–420px`.
- **Detail content max‑width:** `760px` (reading measure) when no properties panel; full‑bleed for List/Timeline.

### 1.4 Radius

`--radius = 0.5rem`. Map: `sm 4px / md 6px / lg 8px / xl 12px`. Rows and inline editors use `md`; cards/popovers/dialogs `lg`; avatars `full` (humans circle, **orgs use `rounded-lg` squircle** to distinguish org from person at a glance); agent avatar `rounded-md` with a violet ring.

### 1.5 Shadows / elevation

Flat by default (borders, not shadows, separate surfaces). Shadows reserved for true overlays:

- `shadow-popover` — `0 4px 12px -2px oklch(0 0 0 / 0.10), 0 2px 4px -2px oklch(0 0 0 / 0.06)` (Cmd+K, popovers, dropdowns).
- `shadow-dialog` — `0 16px 48px -12px oklch(0 0 0 / 0.24)`.
- `shadow-card-hover` — subtle, kanban cards only (kanban is de‑emphasized per product §7).
- Dark mode: shadows weaker, rely on `--border` + `--surface-*` deltas. Define via `@theme inline --shadow-*`.

### 1.6 Org accent (context tint) mechanism

Each `Organization` may carry a derived accent hue (from `Organization.avatar` dominant color or an assigned palette index). When the shell rebinds to an org (product §7), the active org's accent is written to `--org-accent` on the app root via a `data-org-accent` style:

```tsx
// AppShell sets, on context rebind:
<div style={{ "--org-accent": org.accentOklch } as CSSProperties} data-org-id={org.id}>
```

Hub context resets `--org-accent` to `var(--primary)`. Org accent is used **only** for: org avatar ring, active rail indicator bar, org chips, and the active org's sidebar selection highlight. It is **never** used for health/priority/state (those are global semantic tokens).

### 1.7 Density

Three modes via `data-density` on `<html>` (persisted in `Hub.preferences`). Implemented as base‑layer overrides of `--row-py` / `--row-h` consumed by List/row components:

```css
@layer base {
  :root {
    --row-py: 0.5rem;
    --row-h: 2.25rem;
  } /* comfortable (default) */
  [data-density='compact'] {
    --row-py: 0.375rem;
    --row-h: 1.875rem;
  }
  [data-density='spacious'] {
    --row-py: 0.75rem;
    --row-h: 2.75rem;
  }
}
```

`useDensity()` hook reads/writes the preference. Compact targets power users on the Task list; comfortable is default; spacious aids touch/accessibility.

### 1.8 Motion

| Token           | Value                          | Use                              |
| --------------- | ------------------------------ | -------------------------------- |
| `--ease-out`    | `cubic-bezier(0.2, 0, 0, 1)`   | enter/expand                     |
| `--ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | move/reorder                     |
| `--dur-fast`    | `120ms`                        | hover, selection, chip           |
| `--dur-base`    | `180ms`                        | popover/dropdown, group collapse |
| `--dur-slow`    | `240ms`                        | dialog, panel slide, page rebind |

Rules: **no decorative motion.** Group collapse animates height/opacity; Cmd+K fades+scales from 0.98; org rebind is a 240ms cross‑fade of sidebar + content (no slide that implies spatial direction). **All motion wrapped so `@media (prefers-reduced-motion: reduce)` collapses durations to `0ms`** (also the film‑run state). Session "running" pulse = a 2s opacity loop on the session dot, disabled under reduced motion.

---

## 2. Tailwind + shadcn setup (per app)

### 2.1 `components.json` (web app; admin identical; marketing may add `rsc:true` too)

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "app/globals.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@docket/ui/components",
    "ui": "@docket/ui/primitives",
    "utils": "@docket/ui/lib/utils",
    "hooks": "@docket/ui/hooks",
    "lib": "@docket/ui/lib"
  },
  "iconLibrary": "lucide"
}
```

`config: ""` (Tailwind v4 CSS‑first). `cssVariables: true` so primitives consume our semantic tokens. New components from `npx shadcn@latest add` land in `@docket/ui/src/primitives` and are committed (vendored, not a dependency).

### 2.2 Each app's `app/globals.css`

```css
@import '@docket/ui/styles/globals.css'; /* the file in §1 */
@source '../../packages/ui/src/**/*.{ts,tsx}'; /* v4 content detection across the workspace */
```

### 2.3 Theme provider (dark/light)

Use `next-themes` (`attribute="class"`, `defaultTheme="system"`, `enableSystem`, `disableTransitionOnChange`). Wrap each app root. Theme preference persists to `Hub.preferences.theme` on change (server action) **and** localStorage for instant paint; a small inline script prevents FOUC. `data-density` and `data-org-accent` are applied by `AppShell`, not the theme provider.

### 2.4 Dependencies (`@docket/ui/package.json`)

`tailwindcss@^4`, `tw-animate-css`, `class-variance-authority`, `clsx`, `tailwind-merge` (the `cn()` util), `lucide-react`, `next-themes`, `@radix-ui/*` (transitively via shadcn primitives), `cmdk` (Cmd+K), `sonner` (toasts), `vaul` (mobile drawers), `@dnd-kit/*` (List reorder/kanban drag), `react-arborist` **or** custom virtualized tree for the List (see §5.1), `@tanstack/react-virtual` (row virtualization). Pin exact versions; no `tailwindcss-animate` (deprecated).

---

## 3. Component inventory (names + which is shadcn vs custom)

> Naming: shadcn primitives keep their canonical names in `@docket/ui/primitives`. Docket custom components are PascalCase in `@docket/ui/components`, namespaced by area. **Every custom component name below is normative** — engineers must use these exact names.

### 3.1 Vendored shadcn primitives (`@docket/ui/primitives`)

`Button`, `Input`, `Textarea`, `Label`, `Checkbox`, `RadioGroup`, `Switch`, `Select`, `Command` (cmdk), `Dialog`, `Sheet`, `Drawer` (vaul), `Popover`, `DropdownMenu`, `ContextMenu`, `Tooltip`, `HoverCard`, `Tabs`, `Badge`, `Avatar`, `Separator`, `ScrollArea`, `Collapsible`, `Accordion`, `Progress`, `Skeleton`, `Toast`/`Sonner`, `Calendar`, `Resizable` (panels), `Breadcrumb`, `Table` (used only inside custom List cells, not as the List itself), `AlertDialog`, `Toggle`, `ToggleGroup`. All re‑themed by tokens; **do not fork** — extend via composition.

### 3.2 Docket custom components

**Shell** (`components/shell/*`): `AppShell`, `GlobalRail`, `RailOrgAvatar`, `RailButton`, `AddOrgButton`, `ContextSidebar`, `SidebarNavItem`, `SidebarSection`, `SidebarOrgHeader`, `ContextProvider` (rebind logic), `InboxRailButton`, `SearchRailButton`.

**Identity/atoms** (`components/atoms/*`): `ActorAvatar` (handles human/agent/team shape + ring rules), `ActorChip`, `OrgChip` (the org‑label chip used on Hub items), `HealthPill`, `HealthDot`, `StatusIcon` (workflow state ring/check), `PriorityIcon`, `LabelChip`, `KeyHint` (renders `⌘K`, `G then I` chord hints), `IdTag` (mono `ACME-128`), `CountBadge`, `AttentionBadge` (rail unread+approval dot), `ProvenanceChip` (linked‑source tag, product §6), `SessionStatusPill` (running/awaiting/paused/errored), `Timestamp` (relative + hover‑exact), `EmptyState`.

**View primitives** (`components/views/*`): `ListView`, `ListGroup`, `ListSubGroup`, `ListRow`, `ListRowInlineEditor`, `GroupHeader`, `ViewToolbar` (filter/sort/group/display controls), `FilterBar`, `DisplayMenu` (grouping/sub‑grouping/density/properties‑shown), `DetailPage`, `DetailHeader`, `PropertiesPanel`, `PropertyRow`, `PropertyEditor`, `TimelineView` (Roadmap), `TimelineLane`, `TimelineBar`, `TimelineMilestoneMarker`, `TimeScaleHeader`, `KanbanBoard` + `KanbanColumn` + `KanbanCard` (de‑emphasized, built but not default).

**Command** (`components/command/*`): `CommandPalette` (Cmd+K), `CommandScopeToggle` (Hub‑global vs org‑local), `CommandGroup`, `CommandActionItem`, `CommandEntityItem`, `CommandOrgSwitchItem`.

**Sessions** (`components/session/*`): `SessionView`, `SessionActivityStream`, `SessionActivityItem` (variants: thought/action/response/elicitation/error), `InlineApprovalCard`, `ElicitationReply`, `SessionChangesPanel`, `SessionAccountabilityCard`, `SessionControls` (Pause/Take over/Cancel), `SessionPill` (the live pill embedded in List rows), `AgentsHereStrip`.

**Daily Plan / Hub** (`components/hub/*`): `DailyPlan`, `DailyPlanColumn` (Plan), `DailyPlanGroup` (per‑org), `DailyPlanItem`, `PullFromOrgPicker`, `CalendarColumn`, `NeedsAttentionColumn`, `AttentionSection` (Approvals/Blocked/Due/Inbox), `ApprovalDigestItem`, `InboxList`, `InboxItem`, `ActivityFeed`, `PortfolioRoadmap` (composes `TimelineView` with org swimlanes), `OrgSwimlane`.

**Feedback/util** (`components/feedback/*`): `Toaster` (sonner wrapper), `ConfirmDialog`, `KbarHelpDialog` (the `?` keyboard cheatsheet), `ErrorBoundaryFallback`, `LoadingRows`, `OptimisticBadge`.

---

## 4. App Shell

### 4.1 Layout

Three persistent regions, full‑height, no page scroll on the shell itself (each region scrolls independently):

```
┌──────┬───────────────┬───────────────────────────────────────────────┐
│ RAIL │  SIDEBAR      │  MAIN (view primitive)            │ PROPERTIES │
│ 56px │  240px        │  flex-1                           │  (optional)│
│ dark │  surface-1    │  background                       │  surface-1 │
└──────┴───────────────┴───────────────────────────────────────────────┘
```

`AppShell` is a client component holding `ContextProvider` (active context = Hub | org id), density, and org‑accent. Region widths use shadcn `Resizable`; collapse states persist to `Hub.preferences`.

### 4.2 `GlobalRail` (persistent, never rebinds)

Vertical, 56px, `bg-rail text-rail-foreground`, fixed. Order (product §7):

1. **Hub button** (`RailButton`, "Today" — house/hub glyph). Active when context = Hub.
2. **Inbox** (`InboxRailButton`) — carries `AttentionBadge` = cross‑org unread+approval count (from `Notification`).
3. **Search** (`SearchRailButton`) — opens `CommandPalette`. Shows `⌘K` hint on hover.
4. `Separator`.
5. **One `RailOrgAvatar` per Organization** the user belongs to (from memberships), **plus Personal space** avatar. Each: squircle `rounded-lg` avatar, org‑accent ring when active, `AttentionBadge` (its own unread+pending approvals). **Reorderable** (dnd‑kit) and pinnable; order persists to `Hub.preferences.railOrder`.
6. **`AddOrgButton`** ("+") at the bottom.

Selecting Hub or an org avatar **rebinds** `ContextProvider`: sets active context, swaps the `ContextSidebar`, swaps `MAIN`, and (for an org) writes `--org-accent`. Rebind animates as a 240ms cross‑fade (§1.8). The rail itself is **immutable across rebinds** — this is the structural "separation" the product demands (§7).

**Active indicator:** a 3px `bg-org-accent` (or `bg-primary` for Hub) vertical bar on the left edge of the active rail item, plus a brightened avatar.

**Tooltips:** every rail item has a `Tooltip` (right side) with name + a `KeyHint` where bound (Hub `G H`, Inbox `G I`, org switch `⌘1…⌘9`).

### 4.3 `ContextSidebar` (rebinds with context)

`bg-surface-1`, scrollable, header + nav sections. **Two skins:**

**Hub sidebar** (context = Hub) — sections, each a `SidebarNavItem`:
`Today` (default) · `Inbox` · `Portfolio` · `Search`. (Mirrors product §8.1.) Plus a `Personal space` shortcut. Labels here are **fixed** (Hub vocabulary is not skinned — it's the user's own layer).

**Org sidebar** (context = org) — header `SidebarOrgHeader` (org avatar + name + org switcher caret → quick org switch popover), then nav (product §7):
`My Work` · `Triage` · `Initiatives` · `Programs` · `Projects` · `Cycles` · `Teams` · `Views` · `Agents` · `Settings`.

**Every entity label is vocabulary‑skinned** (§6): a Nonprofit org may render `Campaigns / Grants / Events` in place of `Initiatives / Programs / Projects`. `Triage`, `My Work`, `Cycles`, `Teams`, `Views`, `Agents`, `Settings` are skinnable too (skin map provides overrides; falls back to default). `Agents` carries an `AttentionBadge` when sessions await approval in this org. `Views` and `Teams` expand (`Collapsible`) to list saved Views / teams.

### 4.4 `PropertiesPanel`

Right panel, optional, shown on Detail pages and in the Session view's right column. `surface-1`, resizable, collapsible (toggle `]`). Contents are `PropertyRow`s (label left, editable value right via `PropertyEditor`). Universal property editors: assignee/lead/owner (`ActorAvatar` picker → Human|Agent), status/state, priority, dates (`Calendar`), labels, program/project/initiative links, external links (`ProvenanceChip` rows), and the **comments + activity** feed at the bottom (product §8.4: "comments + agent activity live in the properties panel").

### 4.5 Responsive

- **< 768px (mobile):** rail collapses to a top bar with a hamburger → `Sheet` rail; sidebar becomes a `Drawer`; properties panel becomes a bottom `Drawer` (vaul). List rows reflow to two‑line. Cmd+K becomes a full‑screen search sheet.
- **768–1024px:** rail + sidebar persist; properties panel auto‑collapses (toggle to overlay).
- **≥ 1024px:** full three/four region layout.

---

## 5. View Primitives

### 5.1 `ListView` — the workhorse (Linear‑style grouping)

The default view everywhere (product §7: lists preferred, kanban de‑emphasized). Drives Task list, My Work, Triage, Cycle list, Program/Project task sections, Inbox, search results.

**Structure & data contract:**

- Props: `items`, `groupBy`, `subGroupBy?`, `sortBy`, `columns` (visible properties), `density`, `selection`, plus callbacks (`onInlineEdit`, `onReorder`, `onOpen`). Grouping is data‑driven from any property; default for Tasks = **group by Project → sub‑group by Status** (product §8.3 / model `Task.project_id` + `Task.state`).
- **`ListGroup` / `ListSubGroup`:** `GroupHeader` shows group label (vocabulary‑skinned), a `CountBadge`, optional health/aggregate (e.g. progress for a Project group), and a chevron. **Collapsible** (`Collapsible`); collapse state persisted per view. Sub‑groups indent 16px and use a lighter `GroupHeader`.
- **`ListRow`:** fixed `--row-h` (density‑driven), single line. Cell order (Task default): `StatusIcon` · `PriorityIcon` · `IdTag` · title (truncating) · `LabelChip`s · `SessionPill` (if agent‑run) · spacer · `ActorAvatar` (assignee) · due `Timestamp` · `ProvenanceChip` (if linked). Hover reveals row actions (assign, move, delegate) at the right. Selected = `bg-surface-3` + left `org-accent` hairline. Agent‑run rows show `SessionStatusPill` that opens the `SessionView` (product §8.3).
- **Inline edit (`ListRowInlineEditor`):** click a cell or press a property hotkey to edit in place — status (`S`), assignee (`A`), priority (`P`), due (`D`), labels (`L`), project (`Shift+P`). Edits are **optimistic** (`OptimisticBadge`), reconciled with the API; failures toast + revert.
- **Virtualization:** `@tanstack/react-virtual` over flattened (group‑header + row) list so thousands of tasks stay smooth; collapsed groups drop their rows from the virtual set.
- **Reorder:** dnd‑kit for manual sort within a group (e.g. backlog ordering, daily plan); disabled when `sortBy` is a computed field.

**Keyboard (within List):** `↑/↓` move selection; `←/→` collapse/expand group; `Enter`/`O` open Detail; `Space` peek (preview); `X` multi‑select; `Shift+↑/↓` range select; `E` edit title inline; `C` create new item in the focused group; `Cmd+↑/↓` reorder selected; property hotkeys above. The selection/keyboard logic lives in a `useListKeyboard()` hook shared across all List instances.

### 5.2 `DetailPage` + `PropertiesPanel`

Used by Task, Project, Program, Initiative, Cycle (product §8.4–8.5). Composition:

- `DetailHeader`: title (inline‑editable `text-h1`), `HealthPill` (for Project/Program/Initiative), `Progress` (weighted bar — Project only), target date, breadcrumb, and a `Tabs` row (`Overview` / entity‑specific tabs / `Updates`). Project header carries the weighted‑progress bar + health pill (product §8.4); Program shows health + flow snapshot (no % bar); Initiative is timeline‑first.
- Body switches by tab: Overview (description + grouped task List, e.g. **Milestone sections** for Projects), `Tasks` (full `ListView`), `Updates` (its own tab — product §8.4 — list of `Update`s with health), and entity rollups.
- `PropertiesPanel` on the right (§4.4) including the comments+activity feed and the `AgentsHereStrip` ("Agents here: Athena · last: drafted launch post · ⚠ 1 appr").
- **Task detail specifics** (product §8.5): description, **inline subtasks checklist**, a **dependency‑visualization section** (each dependency shows the other task's project, since deps are cross‑project — model §5), the agent **session streams inline in the comment+activity feed**, external links as `PropertyRow`s.

### 5.3 `TimelineView` / Roadmap + `PortfolioRoadmap`

Used by Initiative detail (timeline‑first), and composed into the Hub `PortfolioRoadmap` (product §8.2). Structure:

- `TimeScaleHeader` with adaptive granularity (day/week/month/quarter auto‑picked from visible range; manual override). A **now** line.
- Rows are `TimelineLane`s. For Portfolio: nested `OrgSwimlane` → Program lanes (container, **no bar** — programs never end) → `TimelineBar` per Project inside its program lane.
- `TimelineBar`: name + health tint (`bg-health-*-subtle`, border `health-*`) + `TimelineMilestoneMarker` (◆) + agent/approval signal glyph (🤖/⚠ → `SessionStatusPill`).
- **Initiatives = filter chips** (`FilterBar`) that highlight/dim lanes — not drawn geometry (product §8.2).
- Drag to reschedule (dnd‑kit) where the user has `contribute`; read‑only otherwise. Virtualized horizontally + vertically.

### 5.4 `CommandPalette` (Cmd+K)

Single palette fusing **search + navigation + actions + org‑switch** (product §5, §8.1). Built on `cmdk` `Command` inside a `Dialog`.

- Opens on `⌘K` / `Ctrl+K` from anywhere. `shadow-popover`, scale‑in 0.98.
- **`CommandScopeToggle`** top‑right: **Hub‑global** vs **org‑local** (product §8.1). Org‑local pre‑filters to the active org; Hub‑global searches across all orgs and results carry an `OrgChip`.
- Result groups (`CommandGroup`): **Actions** (`CommandActionItem` — "Create task", "Plan my day", "Delegate to Athena…"), **Go to** (navigation), **Entities** (`CommandEntityItem` — tasks/projects/etc. with `StatusIcon`/`HealthPill`), **Switch org** (`CommandOrgSwitchItem` — triggers shell rebind). Each item shows its `KeyHint` and (Hub scope) its `OrgChip`.
- Sub‑modes: typing `>` forces actions‑only; `@` jumps to people/agents; `#` to labels; nav verbs ("go to…"). Async results stream in with `LoadingRows`.

### 5.5 `SessionView` (activity stream + inline approval)

The first‑class agent surface (product §4.1, §8.6). Two‑column inside a `DetailPage`‑like frame:

- **Left — `SessionActivityStream`:** chronological `SessionActivityItem`s mapped to `session_activity.type` (model §5): `thought` (💭 muted), `action` (with approval lifecycle: proposed→approved/rejected→applied), `response` (💬 agent message), `elicitation` (❓ question → `ElicitationReply` inline textarea), `error` (`session-errored`). An `action` under `act_with_approval` renders an **`InlineApprovalCard`** with primary `Approve & send` + secondary `Review each` / `Reject`, reflecting the agent's `approval_policy`.
- **Right column:** `SessionChangesPanel` ("Changes this session" — the Docket changes produced), then `SessionAccountabilityCard` ("Athena · on behalf of you" — from `Agent.accountable_owner_id` + session initiator), then `SessionControls` (`Pause` / `Take over` / `Cancel session`).
- **Header:** back link to the task, `OrgChip`, `ActorAvatar` (agent, violet ring), `SessionStatusPill` + elapsed `Timestamp`.
- Live: stream appends via subscription; running state shows the pulse dot. **Approvals also mirror to Inbox/Today** — the same `InlineApprovalCard` content renders as an `ApprovalDigestItem` in `NeedsAttentionColumn` and an `InboxItem` (product §4.1, §8.1, §8.6). Provider (Athena/Claude/Codex) is a **minor chip**, not chrome (product §8.6).

### 5.6 `DailyPlan` (Hub Today cockpit)

Three‑pane (product §8.1): `DailyPlanColumn` (Plan) · `CalendarColumn` · `NeedsAttentionColumn`.

- **Plan:** tasks **grouped by organization** (`DailyPlanGroup` with `OrgChip` header), each `DailyPlanItem` org‑chipped. Backed by `DailyPlan`/`DailyPlanItem` (cross‑org, model §5). `PullFromOrgPicker` ("+ pull from any org…") adds items; drag to reorder/timebox (dnd‑kit). Item status `planned|done`.
- **Calendar:** `CalendarColumn` shows the day's events beside the plan (timebox drop target).
- **Needs Attention:** `AttentionSection`s — **Approvals** (`ApprovalDigestItem`, one‑tap for low‑risk, deep into Session for full diff per product §8.1), **Blocked**, **Due today**, **Inbox count**. Sourced from `Notification` + session approvals.
- **Inbox vs Activity** are split surfaces (`InboxList` action items vs `ActivityFeed` passive awareness — product §8.1).

---

## 6. Vocabulary skin system

Implements product §7/§8.7 + model `Organization.vocabulary`. A skin is a map from canonical entity keys to display strings (singular/plural). Presets: **Default**, **Nonprofit**, **Agency** (preset themes per §8.7).

- `VocabularyProvider` (in `AppShell`, scoped to active org context) supplies the active skin; Hub context uses Default. `useVocabulary()` returns `t(key, { count })` → label.
- Canonical keys (must match model entities): `initiative`, `program`, `project`, `cycle`, `task`, `milestone`, `team`, `triage`, `myWork`, `views`, `agents`. Example Nonprofit overrides: `initiative→"Campaign"`, `program→"Program"` (kept), `project→"Event/Grant"`, `cycle→"Giving cycle"`.
- **Rule:** no component renders a hardcoded entity noun. Sidebar nav, group headers, empty states, command palette, create menus, and detail headers all read through `useVocabulary()`. Skin changes are instant (no reload) since it's context state.
- **Open product item (plan §10):** how `Program` renames per skin — provide the override slot now; default keeps "Program".

---

## 7. Keyboard model (global)

A single `useGlobalHotkeys()` registry (scoped so List/editor contexts can claim keys). `KbarHelpDialog` (`?`) lists everything.

| Key                                        | Action                                                                              |
| ------------------------------------------ | ----------------------------------------------------------------------------------- |
| `⌘K` / `Ctrl K`                            | Command palette                                                                     |
| `⌘1`…`⌘9`                                  | Switch to org N in rail (Hub = `⌘0` / `G H`)                                        |
| `G` then `I` / `T` / `P` / `R` / `A` / `V` | Go to Inbox / Today / Projects / Programs / Agents / Views (org‑local; vocab‑aware) |
| `C`                                        | Create (context‑aware: task in a List, item in current entity)                      |
| `[` / `]`                                  | Toggle sidebar / properties panel                                                   |
| `\`                                        | Toggle Hub‑global vs org‑local command scope                                        |
| `J` / `K` or `↑` / `↓`                     | Move selection in List                                                              |
| `X` / `Shift+↑↓`                           | Select / range‑select                                                               |
| `S` `A` `P` `D` `L`                        | Edit status/assignee/priority/due/labels on selection                               |
| `O` / `Enter`                              | Open detail · `Space` peek                                                          |
| `Esc`                                      | Close overlay / clear selection / exit inline edit                                  |
| `?`                                        | Keyboard help                                                                       |

All chords are discoverable via `KeyHint` in menus/tooltips. No key conflicts with screen‑reader or browser reserved combos; `Esc` always escapes.

---

## 8. Accessibility (WCAG 2.2 AA)

- **Color:** every semantic state carries a **non‑color cue** (icon shape + text label) — health, state, priority, session status. Token pairs guarantee ≥4.5:1 text contrast (`*-foreground` on `*-subtle`); verify with automated contrast tests in CI on the token file.
- **Focus:** visible `ring-ring` (2px) on all interactive elements; never remove outline without replacement. Focus is trapped in `Dialog`/`Sheet`/`CommandPalette` and restored on close (Radix handles).
- **Keyboard:** 100% of actions reachable without a pointer (List, palette, approvals, timeline reschedule has a keyboard alternative). Roving tabindex in List/rail.
- **Semantics/ARIA:** Radix primitives provide roles; custom `ListView` uses `role="grid"`/`row`/`gridcell` with `aria-selected`, `aria-expanded` on group headers, `aria-live="polite"` for the session activity stream and optimistic updates, `aria-busy` during loads. `SessionActivityItem` announces new agent messages politely.
- **Motion:** `prefers-reduced-motion` collapses all durations to 0 and stops the session pulse.
- **Targets:** min 24×24px hit area even in compact density (use padding, not size). Mobile 44px.
- **Theme:** dark/light/system; no info conveyed by theme. Org accent is decorative only.

---

## 9. Build order (so engineers can sequence)

1. `tooling/tailwind-config` + `@docket/ui/styles/globals.css` (§1) → verify tokens in both themes via a Storybook/`/_tokens` page.
2. `components.json` + `cn()` util + vendored shadcn primitives (§2–3.1).
3. Atoms (§3.2): `ActorAvatar`, `HealthPill/Dot`, `StatusIcon`, `PriorityIcon`, `OrgChip`, `KeyHint`, `SessionStatusPill`, `AttentionBadge`.
4. App Shell: `GlobalRail` + `ContextSidebar` + `AppShell` + `ContextProvider` + `VocabularyProvider` (§4, §6) with mock context.
5. `ListView` family + `useListKeyboard` (§5.1) — unblocks most screens.
6. `DetailPage` + `PropertiesPanel` (§5.2); `CommandPalette` (§5.4); `useGlobalHotkeys` (§7).
7. `SessionView` + approval components (§5.5); `DailyPlan` cockpit (§5.6); `TimelineView`/`PortfolioRoadmap` (§5.3).
8. A11y + contrast tests; Playwright film‑run styling (reduced motion, 1280×800) per eng plan §6.
