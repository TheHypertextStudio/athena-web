# Native portability: web pattern → Material 3 / Apple HIG

> **Requirement:** MISS-01 (medium) — "Interaction and design-system decisions must be portable to
> native apps — the plan's stated reason for aggressively consulting MD3 — rather than adopting
> web-only patterns that cannot carry over."
>
> **Source quote:** "because we eventually do want to create native apps for everything on the web"
>
> **Acceptance:** "A committed document maps every interaction pattern and design-system primitive
> shipped on web … to its named Material 3 / Apple HIG native counterpart. Any pattern with no native
> counterpart is listed as an explicit exception with a written reason and a migration note. The count
> of shipped patterns that are neither mapped nor listed as an exception is zero."

---

## Count

- **Shipped patterns enumerated:** 33
- **Mapped to a named counterpart on both platforms:** 24
- **Listed as explicit exceptions (with reason + migration note):** 9
- **Shipped patterns neither mapped nor excepted: 0** ✅

Two patterns named in MISS-01's acceptance list — **voice mode** and **timer control** — are **not
shipped on web** and are therefore not in the enumeration. Both are accounted for at the bottom under
"Named in the requirement but not shipped", with the requirement ids that own building them, so no
reader has to wonder whether they were overlooked.

The enumeration was taken from the real components, not from memory:
`packages/ui/src/primitives/`, `packages/ui/src/components/{atoms,shell,views,pickers}/`, and
`apps/web/src/components/` (249 `.tsx` files).

---

## How to read this

"Counterpart" means **a named component or named pattern in the platform's own design system** —
something a native engineer can be pointed at, not a vague analogy. Where the counterpart is a
guideline rather than a component, that is said explicitly.

- **Material 3** counterparts cite the M3 component name, and the Jetpack Compose API where the
  component ships one.
- **Apple HIG** counterparts cite the HIG pattern name, and the SwiftUI API where one exists.
- **Portability note** says what actually has to change at the port — the thing that will bite.

---

## Mapped patterns

### Surfaces and containment

| Docket pattern                  | Web implementation (file)                                                                    | Material 3 counterpart                                   | Apple HIG counterpart                                                        | Portability note                                                                                                                                                                                                                              |
| ------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Modal dialog (all create flows) | `packages/ui/src/primitives/dialog.tsx` (32 web files)                                       | **Dialog** — `BasicAlertDialog` / `AlertDialog`          | **Alert** and **modal sheet** — `.alert`, `.sheet`                           | M3 dialogs are centred at every size; HIG expects a bottom sheet on iPhone and a centred sheet on iPad/macOS. Docket's "create = focused modal" convention survives; the _presentation_ is per-platform.                                      |
| Side / bottom sheet             | `packages/ui/src/primitives/sheet.tsx` → calendar item drawer, Athena panel, command palette | **Side sheet** / **Bottom sheet** — `ModalBottomSheet`   | **Sheet with detents** — `.presentationDetents`; **Inspector** on iPad/macOS | Direct. The `side` prop maps to bottom-sheet on phone and trailing inspector on tablet/desktop.                                                                                                                                               |
| Card                            | `packages/ui/src/primitives/card.tsx` (67 files)                                             | **Cards** — elevated / filled / outlined                 | No `Card`; **grouped list sections** / `GroupBox` on macOS                   | Partial by design. On Apple, a Docket card becomes an inset-grouped `Section`, not a floating rectangle. The repo's "minimize borders, minimize shadows" rule makes this port cheap — a low-chrome card is already close to an inset section. |
| Separator                       | `packages/ui/src/primitives/separator.tsx`                                                   | **Divider**                                              | **Divider**                                                                  | Direct.                                                                                                                                                                                                                                       |
| Focus ring convention           | `packages/ui/src/primitives/focus.ts` (`focusRing`, `focusRingInset`)                        | **Focus indicator** — state layers, `Modifier.focusable` | **Focus ring** — `.focusable()`, focus effects                               | Direct; both platforms own the ring, so the web token is dropped rather than translated.                                                                                                                                                      |

### Menus and overlays

| Docket pattern             | Web implementation (file)                                                                       | Material 3 counterpart                                   | Apple HIG counterpart                                      | Portability note                                                                                                                                                               |
| -------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Context menu (right-click) | `packages/ui/src/primitives/context-menu.tsx` → `apps/web/src/components/triage/triage-row.tsx` | **Menu** opened by long-press                            | **Context menu** — `.contextMenu`                          | The trigger changes, not the content: right-click → long-press (both platforms). Keep menu items declarative so the same item list feeds all three triggers.                   |
| Dropdown / overflow menu   | `packages/ui/src/primitives/dropdown-menu.tsx` (22 web files)                                   | **Menu** — `DropdownMenu`                                | **Pull-down menu** — `Menu`                                | Direct.                                                                                                                                                                        |
| Popover                    | `packages/ui/src/primitives/popover.tsx` (6 files)                                              | **Menu** surface / `Popup` (no named "popover")          | **Popover** — `.popover`                                   | M3 has no popover; on Android the same content becomes a menu or a bottom sheet. Keep popover bodies short enough to survive that demotion.                                    |
| Tooltip                    | `packages/ui/src/primitives/tooltip.tsx`                                                        | **Plain tooltip** / **Rich tooltip** — `PlainTooltipBox` | **Tooltip** — `.help()` (macOS), pointer tooltips (iPadOS) | Direct on M3 and macOS. On iPhone there is no tooltip; the label must already exist as an accessible name (it does — `aria-label`), so the port is a deletion, not a redesign. |
| Tab-overflow menu          | `packages/ui/src/components/shell/tab-overflow-menu.tsx`                                        | **Menu**                                                 | **Pull-down menu**                                         | Direct; it is a menu.                                                                                                                                                          |

### Lists, tables and selection

| Docket pattern                              | Web implementation (file)                                                                            | Material 3 counterpart                                                                 | Apple HIG counterpart                                                | Portability note                                                                                                                                                                      |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List row (the primary display primitive)    | `packages/ui/src/components/views/ListRow.tsx`, `EntityListRow.tsx`, `entity-list-row-slots.tsx`     | **Lists** — one/two/three-line list items                                              | **Lists and tables** — `List` row                                    | Direct, and the reason the repo standardised on rows over card grids: list items are the one primitive both native systems ship as a first-class component.                           |
| Grouped list with headers                   | `ListGroup.tsx`, `ListSubGroup.tsx`, `GroupHeader.tsx`, `flatten-groups.ts`                          | **List** with subheaders                                                               | `Section` with header                                                | Direct.                                                                                                                                                                               |
| List selection (drives the command palette) | `packages/ui/src/components/views/EntityTable.tsx:77–79` (`selected`, `onSelect`), applied at `:200` | **List item selection** — selected state layer, `Modifier.selectable`                  | **Edit-mode multi-selection** — `List(selection:)` + `EditButton`    | Both platforms model selection as a set held by the list, which is exactly the controlled `ReadonlySet<string>` shape already used. The port is mechanical.                           |
| Empty state                                 | `packages/ui/src/components/atoms/EmptyState.tsx`                                                    | Guidance only (no named M3 component)                                                  | **`ContentUnavailableView`** — a real SwiftUI view                   | Asymmetric: Apple ships the component, Material does not. Port to `ContentUnavailableView` on Apple; hand-build on Android from the same copy.                                        |
| Status icon                                 | `packages/ui/src/components/atoms/StatusIcon.tsx`                                                    | **Material Symbols**                                                                   | **SF Symbols**                                                       | Direct, but the glyph _set_ changes. Keep status → semantic-name mapping in shared code and resolve the glyph per platform.                                                           |
| Avatar / identity glyph                     | `packages/ui/src/primitives/avatar.tsx`, `components/atoms/{ActorAvatar,IdentityGlyph}.tsx`          | Avatar as used in **Lists** / **Top app bar** (convention, not a standalone component) | Profile image conventions in **Lists** (convention, not a component) | Convention on both sides. The fallback-initials logic is the portable part and should live in shared logic, not in the view.                                                          |
| Skeleton loading                            | `packages/ui/src/primitives/skeleton.tsx` (17 files)                                                 | **Loading indicators** (M3 Expressive `LoadingIndicator`)                              | **Redacted placeholder** — `.redacted(reason: .placeholder)`         | Apple's is a modifier over real content; Android's is a separate indicator. Keep the loading _shape_ derivable from the row component so `.redacted` can be applied to the real view. |

### Input and pickers

| Docket pattern                 | Web implementation (file)                                                                                                                      | Material 3 counterpart                                         | Apple HIG counterpart                                                                      | Portability note                                                                                                                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Buttons                        | `packages/ui/src/primitives/button.tsx` (150 files)                                                                                            | **Common buttons** — filled, tonal, outlined, text, elevated   | **Buttons** — `.borderedProminent`, `.bordered`, `.plain`                                  | Direct; the variant vocabulary already matches M3's. Tonal has no Apple equivalent → renders `.bordered`.                                                                               |
| Text input                     | `packages/ui/src/primitives/input.tsx` (53 files)                                                                                              | **Text fields** — filled / outlined                            | **Text field** — `TextField`                                                               | Direct.                                                                                                                                                                                 |
| Date picker                    | `packages/ui/src/components/pickers/DatePicker.tsx`                                                                                            | **Date pickers** — docked / modal                              | **`DatePicker`**                                                                           | Direct; both ship the component.                                                                                                                                                        |
| Enum / option / entity pickers | `pickers/{EnumPicker,OptionPicker,EntityPicker,EntityMultiPicker,ActorPicker,PickerList}.tsx`                                                  | **Menu**, or **Bottom sheet** with a list for long option sets | **`Picker`** (menu / wheel / navigation-link style)                                        | Direct. `EntityMultiPicker` maps to a multi-select `List` on Apple and a filter-chip row on Android.                                                                                    |
| Labels picker                  | `pickers/LabelsPicker.tsx`                                                                                                                     | **Input chips** in a text field                                | Token field (macOS) / `List` multi-select (iOS)                                            | Android is the closer fit; iPhone has no token field, so the picker becomes a pushed multi-select list.                                                                                 |
| Inline property editor         | `pickers/PropertyTrigger.tsx`, `apps/web/src/components/property-pickers/property-panel.tsx`                                                   | **Menu** anchored to a text button                             | **Form row with a menu** — `Form` + `Menu`                                                 | Direct, and the reason the repo banned dead "Not set" read-only rows: a Form row that opens a menu is the native default, so the functional-editor rule _is_ the portable one.          |
| Chips (org filter, view scope) | `packages/ui/src/primitives/badge.tsx`, `apps/web/src/components/org-chip.tsx`, `portfolio/org-filter-chips.tsx`, `views/view-scope-badge.tsx` | **Chips** — assist / filter / input / suggestion               | No first-class chip: **capsule buttons** for filters, `.badge()` for counts, tags in lists | Asymmetric. Filter chips port to a segmented control or a capsule button row on Apple; a count badge ports to `.badge()`. Do not port a Docket chip to an Apple chip — there isn't one. |

### Navigation and shell

| Docket pattern           | Web implementation (file)                                                | Material 3 counterpart                                                  | Apple HIG counterpart                                                  | Portability note                                                                                                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Single flattened sidebar | `packages/ui/src/components/shell/{Sidebar,SidebarNavItem}.tsx`          | **Navigation drawer** / **Navigation rail** — `NavigationSuiteScaffold` | **Sidebar** — `NavigationSplitView`                                    | Direct on tablet/desktop. On phone both platforms collapse to a bottom tab bar (M3 **Navigation bar**, HIG **Tab bar**), which forces a top-N choice from the sidebar's sections — the one real design decision in this port. |
| Workspace switcher       | `shell/WorkspaceSwitcher.tsx`, `workspaces.ts`                           | **Menu** in the navigation drawer header                                | **Menu** in the sidebar header / `NavigationSplitView` sidebar top     | Direct.                                                                                                                                                                                                                       |
| Activity bar / aside     | `shell/ShellActivityBar.tsx`, `ShellAside.tsx`, `ShellDrawerContext.tsx` | **Navigation rail**                                                     | **Inspector** — `.inspector`                                           | Direct.                                                                                                                                                                                                                       |
| In-page tabs             | `packages/ui/src/primitives/tabs.tsx` (7 files)                          | **Tabs** — primary / secondary, `TabRow`                                | **Segmented control** — `Picker(.segmented)`; `TabView` for page-level | Direct. Use segmented control for ≤4 options, a scrollable tab row above that.                                                                                                                                                |
| App shell frame          | `shell/AppShell.tsx`, `apps/web/src/components/app-shell-frame.tsx`      | **Scaffold**                                                            | `NavigationSplitView` + `.toolbar`                                     | Direct; both platforms own the scaffold, so the web frame is replaced rather than translated.                                                                                                                                 |

### Motion and manipulation

| Docket pattern                       | Web implementation (file)                                                                                                                                                                                                  | Material 3 counterpart                                                                         | Apple HIG counterpart                                           | Portability note                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Drag and drop (global, entity-typed) | `packages/ui/src/lib/draggable.ts`, `apps/web/src/lib/entity-drag.ts` (MIME `application/x-docket-entity`, `:30`), `initiatives/hierarchy-dnd.ts`, `timeline/use-timeline-drag.ts`, `scheduling/scheduling-drag-object.ts` | **Drag and drop** — `Modifier.dragAndDropSource` / `dragAndDropTarget`, `ClipDescription` MIME | **Drag and drop** — `.draggable` / `.dropDestination`, `UTType` | The one genuinely portable custom decision in the codebase: a **typed payload behind a declared MIME** is exactly how both natives model it. `application/x-docket-entity` becomes a `UTType` (`studio.hypertext.docket.entity`) on Apple and a `ClipDescription` MIME on Android; `EntityDragItem`'s discriminated union is the payload on all three. |

---

## Explicit exceptions

Patterns with no named counterpart on at least one platform. Each records **why** and **what to do
at the port**.

### E1 — Document tab bar (multi-document tabs)

- **Web:** `packages/ui/src/components/shell/{TabBar,tab-item,tab-overflow-menu,tab-types}.tsx`
- **No counterpart:** Material 3 has no multi-document tab strip; M3 Tabs switch views _within_ one
  screen, which is a different thing. Apple has window tabbing on macOS (`NSWindow` tabbing) and
  browser-style tabs in Safari/Files on iPadOS, but no HIG component for an app-level document tab
  strip on iPhone.
- **Reason it exists on web:** the browser is a single-window medium and Docket is a multi-document
  tool; without tabs, opening a second task destroys the first.
- **Migration note:** macOS → native window tabbing, one document per tab. iPadOS → a custom strip
  modelled on Files, retaining the repo's fixed-width / flex-title / right-aligned-close rules.
  iPhone → **drop the tab bar entirely** and use a navigation stack; the tab metaphor does not
  survive a phone, and pretending otherwise is how a web app comes to feel foreign. The tab _state_
  (`tab-types.ts`) stays; only the presentation is dropped.

### E2 — Command palette

- **Web:** `apps/web/src/components/command-palette/` (provider, trigger, palette, `filter.ts`,
  `use-palette-keyboard.ts`, `scope-toggle.tsx`, `use-command-actions.ts`)
- **No counterpart:** neither system ships a command palette. Material 3's nearest surface is
  **Docked search**; Apple's nearest is Spotlight, which is an OS feature an app cannot instantiate.
- **Reason it exists on web:** it is the keyboard-first spine of the product — selection in the
  entity table drives it, and it is how power users act without a pointer.
- **Migration note:** macOS → the **menu bar** is the native command surface; every palette action
  should be registered as a menu command with its key equivalent, and the palette itself kept as a
  secondary window. iPadOS → keep the palette (hardware keyboards are common) but present it as a
  `.sheet`. iPhone → replace with **docked search** plus per-row context menus; the action registry
  (`use-command-actions.ts`) is the portable artefact and should be platform-agnostic so all three
  presentations read from it.

### E3 — Hover card

- **Web:** `packages/ui/src/primitives/hover-card.tsx`
- **No counterpart:** hover is not an input modality on touch. Material 3 has no hover card; Apple has
  pointer-driven previews on iPadOS/macOS but no HIG hover-card component.
- **Migration note:** on Apple, the content becomes a **context-menu preview** (`.contextMenu(preview:)`),
  which is the same information reached by long-press. On Android, it becomes a **rich tooltip** or is
  dropped. Nothing may be hover-only — the information must also be reachable by tap, which is already
  the case in Docket.

### E4 — Entity table (aligned multi-column rows)

- **Web:** `packages/ui/src/components/views/{EntityTable,entity-table-row,entity-table-columns}.tsx`,
  `apps/web/src/components/views/task-table.tsx`
- **No counterpart on Material 3:** M2 specified data tables; **M3 dropped them** and offers no
  replacement. Apple _does_ ship `Table` (macOS, iPadOS), so the exception is one-sided.
- **Migration note:** macOS/iPadOS → SwiftUI `Table` with the same column set
  (`entity-table-columns.ts` is the shared column definition). Android and iPhone → the table
  degrades to the **list row** already shipped (`EntityListRow`), which is why the two share one
  aligned-row contract. That shared contract is the migration path; keep it.

### E5 — Scheduling canvas (the calendar time grid)

- **Web:** `apps/web/src/components/scheduling/*`, `apps/web/src/app/(app)/calendar/*`
- **No counterpart:** neither design system specifies a calendar grid. Apple ships EventKitUI for
  _viewing_ system events (`EKEventViewController`), which is not the same thing as a manipulable
  scheduling surface; Material has nothing.
- **Migration note:** hand-built on both platforms. The portable layer is the geometry and gesture
  contract (`scheduling-drag-object.ts`, `use-scheduling-region-selection.ts`), not the DOM. Port the
  drag/resize/region-select semantics; rebuild the rendering.

### E6 — Timeline (dependency/date engine)

- **Web:** `apps/web/src/components/timeline/*` (`use-timeline-drag.ts` and siblings)
- **No counterpart:** neither system has a Gantt-style timeline.
- **Migration note:** as E5 — port the model and the gesture semantics, rebuild the rendering. On
  phone, the timeline should degrade to a **date-grouped list** rather than a pinch-zoom canvas.

### E7 — Rich document editor

- **Web:** `apps/web/src/components/editor/{entity-document,freeform-text,editable-title,editable-subtitle}.tsx`
- **No counterpart on Material 3:** M3 text fields are single-purpose inputs; there is no rich-text
  component. Apple ships `TextEditor` with `AttributedString` (iOS 18+/macOS 15+), so this exception
  is one-sided.
- **Migration note:** Apple → `TextEditor` over `AttributedString`. Android → Compose
  `BasicTextField` with a custom annotated-string toolbar. The document _model_ must be
  platform-neutral (it already is — it round-trips through the API), and only the editing surface is
  rebuilt.

### E8 — Agent elicitation card with inline reply

- **Web:** `apps/web/src/components/agents/activity-item.tsx:134–135` (the reply affordance) and
  `:255` (the inline reply box); rendered in the Athena conversation
  (`apps/web/src/components/athena/athena-conversation.tsx:286`) and the project/task activity feeds.
- **No counterpart:** "an agent asking the user a typed question inline in a feed" is not a pattern
  either design system names. The nearest M3 construct is a **Card** containing a text field; the
  nearest Apple construct is a **Form row** with an inline field, or a **notification with a text
  input action**.
- **Migration note:** compose from mapped primitives rather than inventing a component — card/section
  - text field + confirm button. The important portability constraint is that the elicitation's
    _schema_ drives the control (a confirmation → a two-button alert; a date → `DatePicker`; a
    selection → `Picker`), so a schema-driven renderer keeps all three platforms in step. That renderer
    is ATH-46's job and is `not-built`; building it web-only would create exactly the web-shaped debt
    MISS-01 exists to prevent.

### E9 — Banner / nudge and offline state

- **Web:** `apps/web/src/components/recovery-nudge-banner.tsx`, `offline-state.tsx`,
  `service-worker-provider.tsx`
- **No counterpart:** **Banner was an M2 component and is absent from Material 3**; Apple has no
  banner pattern (its banners are system notifications, which an app cannot draw).
- **Migration note:** on Android, a nudge becomes a **snackbar** (transient) or an inline **card** at
  the top of the list (persistent). On Apple, it becomes a **`Section` footer** or a list header row.
  Offline state on both becomes a toolbar/status indicator rather than a full-width bar. Persistent
  banners are the least portable of Docket's patterns and should not proliferate.

---

## Named in the requirement but not shipped

MISS-01's acceptance names ten patterns as examples. Eight are shipped and mapped above. Two are not
shipped on web at all, so there is no pattern to map — recorded here so the gap is assigned rather
than silently omitted.

| Named pattern     | Shipped on web? | Evidence                                                                                                                                                                                                                            | Who owns building it                                                                                                                        |
| ----------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Voice mode**    | No              | `grep -rniE 'voice mode\|SpeechRecognition\|getUserMedia' apps packages --include='*.ts*'` → the only hit is a generated Cloudflare type declaration (`apps/runner/worker-configuration.d.ts`); no component, no route, no surface. | **ACH-01 … ACH-08** (all `not-built`): a realtime duplex voice mode integrated into the single Athena session.                              |
| **Timer control** | No web surface  | The API exists (`apps/api/src/time/{service,commands}.ts`, `apps/api/src/routes/time.ts`), but a web grep for any client call (`'/v1/time'`, `timeEntry`, `startTimer`, "tracking session") over `apps/web/src` returns nothing.    | **CORE-35 … CORE-46** (mostly `not-built`): a universal timer startable from anywhere, joined segments, MCP control, public read interface. |

When either is built, it must land in this document in the same pass. The native counterparts are
already known and should be designed toward from the start:

- **Voice mode** → M3 has no voice component (use a **FAB** entry point plus a full-screen surface);
  Apple has **SiriKit / `AVAudioEngine`** with the system's own live-audio affordances, and iOS 18's
  live-activity presentation for an in-progress session. Neither ships a "voice mode" component, so
  this will be an exception with a migration note when it exists.
- **Timer control** → Android **foreground service notification** with actions; Apple **Live Activity
  / Dynamic Island** plus a **`ControlWidget`** on iOS 18+. Both platforms have first-class,
  _named_ answers here, which is a strong argument for designing the timer's state model as
  platform-neutral from day one (start/pause/resume/segment-join) rather than as React state.

---

## Maintenance rule

A new interaction pattern or design-system primitive is not finished until it appears in this file,
either mapped or excepted. The count line at the top must be updated in the same change. If a pattern
cannot be mapped and its migration note reads "rebuild from scratch on both platforms", that is a
signal to reconsider the pattern — not a licence to add it.
