# Docket design system — the contract

> **Status**: enforced in CI
> **Implementation**: `packages/ui/src/primitives/`
> **Enforcement**: `packages/test-utils/tests/design-policies/design-token-policy.test.ts`
> **Import path**: `@docket/ui/primitives`

Every screen in Docket is built on this contract. It is deliberately small and deliberately
closed: each vocabulary below is a finite list, and there is no supported way to express a value
outside it. Where a rule can be enforced by the type system it is; where it cannot, it is enforced
by a policy test that runs under `turbo run test` and gates the production deploy.

The short version:

- **Height** comes from a five-step scale, and controls inherit it from the group they are in.
- **Type** comes from fifteen MD3 roles, and each role sets size, line-height, weight, and tracking
  together.
- **Pills** are `Chip` (pressable, must have a leading icon) or `Badge` (readable, fully round).
  Nothing else is pill-shaped.
- **Fields** are one recipe with three variants, and none of them has a shadow.
- **Shadows** exist only on overlays. **Borders** are the exception, not the separator of choice.
- **Nothing changes size** when you hover, focus, press, or select it.

---

## 1. Control heights

`packages/ui/src/primitives/control.tsx`

Five steps, 4px apart. This is the answer to "how tall is this thing", everywhere.

| Step | Height | Padding-x | Gap | Icon | Label token    | Field text token | Use for                                                  |
| ---- | ------ | --------- | --- | ---- | -------------- | ---------------- | -------------------------------------------------------- |
| `xs` | 24px   | 8px       | 4px | 14px | `label-small`  | `body-small`     | metadata chips inside a dense list row                   |
| `sm` | 28px   | 10px      | 6px | 16px | `label-medium` | `body-small`     | dense toolbars, inline row affordances                   |
| `md` | 32px   | 12px      | 8px | 18px | `label-large`  | `body-medium`    | **default** — page toolbars, property chips, filter bars |
| `lg` | 36px   | 14px      | 8px | 18px | `label-large`  | `body-medium`    | dialog and settings form fields, menu rows               |
| `xl` | 40px   | 16px      | 8px | 20px | `label-large`  | `body-large`     | primary dialog actions, the global search field          |

`md` is 32px because that is MD3's chip container height, and a chip is the most common inline
control in this product. Everything else steps from it.

### The rule that makes inline heights match

**Do not set a control's height.** Put controls in a `ControlGroup` and let them read it:

```tsx
import { Button, Chip, ControlGroup, Input } from '@docket/ui/primitives';

// Every child is 32px tall. Not by convention — there is one number in play.
<ControlGroup controlSize="md">
  <Button variant="ghost">Filter</Button>
  <Chip icon={<Filter />} variant="filter">
    Assigned to me
  </Chip>
  <Input variant="filled" placeholder="Search" />
</ControlGroup>;
```

`ControlGroup` supplies `items-center` and the step's gap itself, so children declare no alignment
and no spacing of their own. Groups nest; an inner group with no `controlSize` inherits the outer
one. A single control may override with its own `controlSize`, which should be rare and should have
a reason.

Outside any group every control falls back to `md`, so a bare `<Button>` and a bare `<Chip>` still
agree.

### API

```ts
const CONTROL_SIZES: readonly ['xs', 'sm', 'md', 'lg', 'xl'];
type ControlSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
const DEFAULT_CONTROL_SIZE: ControlSize; // 'md'

interface ControlMetrics {
  readonly height: string; // 'h-8'
  readonly minHeight: string; // 'min-h-8'
  readonly width: string; // 'w-8'   (icon-only)
  readonly heightPx: number; // 32
  readonly paddingX: string; // 'px-3'
  readonly paddingXPx: number; // 12
  readonly gap: string; // 'gap-2'
  readonly icon: string; // 'size-4.5!'
  readonly iconApply: string; // '[&_svg]:size-4.5!'
  readonly iconPx: number; // 18
  readonly labelToken: TypeToken; // 'label-large'
  readonly fieldToken: TypeToken; // 'body-medium'
}
const CONTROL: Readonly<Record<ControlSize, ControlMetrics>>;

const CONTROL_RADIUS: 'rounded-md'; // 8px — every control
const CONTAINER_RADIUS: 'rounded-lg'; // 10px — every floating container

function useControlSize(explicit?: ControlSize): ControlSize;
function useControlMetrics(explicit?: ControlSize): ControlMetrics;
function controlChrome(
  size: ControlSize,
  options?: { readonly iconOnly?: boolean; readonly growable?: boolean },
): string;

interface ControlGroupProps extends React.HTMLAttributes<HTMLElement> {
  readonly controlSize?: ControlSize;
  readonly as?: React.ElementType;
  readonly orientation?: 'horizontal' | 'vertical';
  readonly wrap?: boolean;
}
function ControlGroup(props: ControlGroupProps): React.JSX.Element;
```

CSS mirrors: `--control-h-xs` … `--control-h-xl` in `globals.css`. A test asserts the two agree, so
they cannot drift.

### Radius

| Radius                            | Value | Used by                                          |
| --------------------------------- | ----- | ------------------------------------------------ |
| `rounded-md` (`CONTROL_RADIUS`)   | 8px   | buttons, chips, inputs, selects, menu rows, tabs |
| `rounded-lg` (`CONTAINER_RADIUS`) | 10px  | menus, popovers, tooltips, dialogs               |
| `rounded-xl`                      | 14px  | cards, panels                                    |
| `rounded-full`                    | —     | **avatars and `Badge` only**                     |

If a `rounded-full` thing responds to a click, it is a chip wearing the wrong shape.

---

## 2. Type

`packages/ui/src/primitives/text.tsx`

Fifteen MD3 roles. Each `--text-<role>` token in `globals.css` carries **size, line-height, weight,
and letter-spacing together**, so choosing a role chooses all four and there is nothing left to
tune at the callsite.

| Family   | Role              | Size / line-height | Weight | Use for                                                              |
| -------- | ----------------- | ------------------ | ------ | -------------------------------------------------------------------- |
| display  | `display-large`   | 57 / 64            | 400    | the single hero number or word on a marketing or empty-state surface |
|          | `display-medium`  | 45 / 52            | 400    | "                                                                    |
|          | `display-small`   | 36 / 44            | 400    | "                                                                    |
| headline | `headline-large`  | 32 / 40            | 400    | a page's own name, when the page is a document                       |
|          | `headline-medium` | 28 / 36            | 400    | "                                                                    |
|          | `headline-small`  | 24 / 32            | 400    | dialog titles, entity detail titles                                  |
| title    | `title-large`     | 22 / 28            | 400    | section headings inside a page                                       |
|          | `title-medium`    | 16 / 24            | 500    | card and panel headings, list-group headers                          |
|          | `title-small`     | 14 / 20            | 500    | dense section headings, table column groups                          |
| body     | `body-large`      | 16 / 24            | 400    | long-form reading copy (descriptions, comments)                      |
|          | `body-medium`     | 14 / 20            | 400    | **the app's default text** — row titles, field values, paragraphs    |
|          | `body-small`      | 12 / 16            | 400    | secondary metadata under a row title                                 |
| label    | `label-large`     | 14 / 20            | 500    | control labels: buttons, chips, tabs, menu rows                      |
|          | `label-medium`    | 12 / 16            | 500    | dense control labels, table column headers                           |
|          | `label-small`     | 11 / 16            | 500    | counts, badges, timestamps, keyboard hints                           |

`body-*` is prose the user reads. `label-*` is a name for something the user acts on or scans.

### Banned, and enforced

`text-xs`, `text-sm`, `text-base`, `text-lg`, `text-xl`, `text-2xl`…`text-9xl`, `text-[13px]`,
`font-medium`, `font-semibold`, `font-bold`, `leading-tight`, `leading-none`, `leading-[1.1]`,
`tracking-tight`, `tracking-widest`, `tracking-[-0.015em]`.

There is no "make this bolder" utility. If a label needs more weight than `body-medium`, it is
`label-large` or `title-small` — a different role, not a modified one.

### API

```ts
const TYPE_TOKENS: readonly TypeToken[]; // the 15 roles, MD3 order
type TypeToken =
  | 'display-large'
  | 'display-medium'
  | 'display-small'
  | 'headline-large'
  | 'headline-medium'
  | 'headline-small'
  | 'title-large'
  | 'title-medium'
  | 'title-small'
  | 'body-large'
  | 'body-medium'
  | 'body-small'
  | 'label-large'
  | 'label-medium'
  | 'label-small';

const TEXT_TONES: readonly TextTone[];
type TextTone = 'default' | 'muted' | 'accent' | 'error' | 'inverse' | 'inherit';

function typeClass(token: TypeToken): string; // 'body-medium' -> 'text-body-medium'
function toneClass(tone: TextTone): string; // 'muted' -> 'text-on-surface-variant'

interface TextProps extends React.HTMLAttributes<HTMLElement> {
  readonly as?: React.ElementType; // default 'span'
  readonly token: TypeToken; // required
  readonly tone?: TextTone; // default 'default'
  readonly truncate?: boolean;
  readonly numeric?: boolean; // tabular-nums for values that change in place
}
function Text(props: TextProps): React.JSX.Element;
```

Tone → colour: `default` → `text-on-surface`, `muted` → `text-on-surface-variant`, `accent` →
`text-primary`, `error` → `text-error`, `inverse` → `text-inverse-on-surface`, `inherit` → none.

```tsx
<Text as="h2" token="title-medium">Active projects</Text>
<Text token="body-small" tone="muted">Updated 3 hours ago</Text>
<Text token="label-small" tone="muted" numeric>{count}</Text>
```

Element and role are independent: a visually small section heading is
`<Text as="h3" token="label-medium">`, which keeps the document outline right without bending the
scale to match it.

---

## 3. Chips and pills

`packages/ui/src/primitives/chip.tsx`

### The MD3 research

Verified against the Material Web token source (`tokens/versions/v0_192/_md-comp-assist-chip.scss`,
`_md-comp-filter-chip.scss`, `_md-comp-input-chip.scss`, `_md-comp-suggestion-chip.scss`,
`tokens/_md-comp-assist-chip.scss` for the spacing tokens) and cross-checked against the Material
Components Android chip specification. Fetched, not recalled.

| MD3 token                          | Value                                             | Applies to                                              |
| ---------------------------------- | ------------------------------------------------- | ------------------------------------------------------- |
| `container-height`                 | `32dp`                                            | all four chip types                                     |
| `container-shape`                  | `corner-small` = `8dp`                            | all four — chips are **not** pills                      |
| `label-text-*`                     | `label-large` (14 / 20, weight 500, tracking 0.1) | all four                                                |
| `with-icon-icon-size`              | `18dp`                                            | all four                                                |
| `leading-space` / `trailing-space` | `16dp`                                            | text-only chip                                          |
| `with-leading-icon-leading-space`  | `8dp`                                             | icon-ed chip                                            |
| `icon-label-space`                 | `8dp`                                             | all four                                                |
| `outline-width`                    | `1dp` unselected, `0dp` selected                  | assist / filter / suggestion / input                    |
| `container-elevation`              | `level0` — flat                                   | all four; only the separate "elevated chip" is `level1` |
| min touch target                   | `48dp`                                            | Android `chipMinTouchTargetSize`                        |

The four MD3 chip types, and what each one is _for_:

| Type           | Question it answers                  | Docket usage                                                                     |
| -------------- | ------------------------------------ | -------------------------------------------------------------------------------- |
| **assist**     | "do something to this object"        | property chips that open a picker — "No priority", "+ Set owner", "Set due date" |
| **filter**     | "narrow what I am looking at"        | filter-bar chips, "Assigned to me", saved-view toggles                           |
| **input**      | "here is a discrete thing you chose" | assignee, label, project, and cycle chips inside fields and property rows        |
| **suggestion** | "here is something you might want"   | Athena suggestions, template pickers in create dialogs                           |

### Docket's three documented deviations

1. **8px corners, not a pill.** This is MD3's own answer to "be more intentional about pill-like
   structures": `corner-full` belongs to avatars and count badges. A chip that is fully round reads
   as a badge — a thing you look at — rather than a chip, a thing you press.
2. **Padding does not shrink when an icon is present.** MD3 drops leading space from 16dp to 8dp
   for icon-ed chips. That is correct for a free-floating mobile chip set and wrong here, where
   chips stack in property rows: an icon-ed chip and an icon-less chip in adjacent rows would start
   their content on two different vertical axes. Constant padding preserves the axis.
3. **A filter chip's leading slot is always occupied.** MD3 filter chips grow horizontally when the
   selected checkmark appears. Docket forbids an interactive element changing size, so the filter
   chip _swaps_ its own icon for the checkmark. Same width, selected or not.

### How icon-less chips are prevented

`ChipProps` is a discriminated union. A chip must supply `icon`, **or** `avatar`, **or** a
`leadingNone` naming one of exactly two documented exemptions. `<Chip>No priority</Chip>` does not
compile.

| Exemption             | When it is correct                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `md3-suggestion-chip` | MD3's suggestion chip is specified without a leading icon; the suggested text is the whole content. Only with `variant="suggestion"`. |
| `overflow-count`      | The "+3" affordance standing for hidden siblings. The number _is_ the content; a glyph beside it would read as a fifth item.          |

Both are greppable: `grep -rn 'leadingNone' apps/`.

### API

```ts
const CHIP_VARIANTS: readonly ['assist', 'filter', 'input', 'suggestion'];
type ChipVariant = 'assist' | 'filter' | 'input' | 'suggestion';

const CHIP_TONES: readonly ['tonal', 'outlined'];
type ChipTone = 'tonal' | 'outlined';

type ChipLeadingExemption = 'md3-suggestion-chip' | 'overflow-count';

type ChipProps = {
  readonly controlSize?: ControlSize; // omit to inherit from ControlGroup
  readonly variant?: ChipVariant; // default 'assist'
  readonly tone?: ChipTone; // default 'tonal'
  readonly selected?: boolean;
  readonly onRemove?: () => void; // input chips; renders MD3's trailing remove action
  readonly removeLabel?: string; // required whenever onRemove is set
  readonly asChild?: boolean;
  readonly children: React.ReactNode;
} & (
  | { readonly icon: React.ReactNode }
  | { readonly avatar: React.ReactNode }
  | { readonly leadingNone: ChipLeadingExemption }
) &
  Omit<React.ComponentProps<'button'>, 'children' | 'color'>;

function Chip(props: ChipProps): React.JSX.Element;
```

Tones: `tonal` (default) fills with `surface-container-high` and draws a transparent border;
`outlined` draws an `outline-variant` hairline over a transparent fill, for chips sitting on an
already-tinted container. Selected (either tone) is `secondary-container` / `on-secondary-container`
with a transparent border — so selection changes colour and nothing else.

```tsx
// Property chip that opens a picker
<DropdownMenuTrigger asChild>
  <Chip icon={<Flag />}>No priority</Chip>
</DropdownMenuTrigger>

// Filter chip — identical width selected or not
<Chip variant="filter" icon={<User />} selected={mine} onClick={toggle}>Assigned to me</Chip>

// Entity chip with a remove affordance
<Chip variant="input" avatar={<Avatar … />} onRemove={unassign} removeLabel="Remove Alex">
  Alex Kim
</Chip>
```

### Badge is not Chip

`packages/ui/src/primitives/badge.tsx`

A **Badge** is something you _read_: a count, a state word, a "New" marker. Fully round,
non-interactive, `label-small`, `tabular-nums`, no leading-icon requirement (it has no action to
name), no border except on the `outline` variant (which has no fill, so without one it is only
text), never a shadow.

```ts
const BADGE_VARIANTS: readonly ['default', 'secondary', 'destructive', 'outline'];
type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';
function badgeVariants(options?: {
  readonly variant?: BadgeVariant | null;
  readonly className?: string;
}): string;
function Badge(
  props: { readonly variant?: BadgeVariant | null } & React.ComponentProps<'span'>,
): React.JSX.Element;
```

---

## 4. Fields

`packages/ui/src/primitives/field.tsx`

One recipe. Three variants. No shadow in any state — default, hover, focus, filled, disabled, or
error.

| Variant    | Border                | Fill                     | Use for                                                                                                  |
| ---------- | --------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------- |
| `outlined` | 1px `outline-variant` | transparent              | **default** — dialog and settings forms                                                                  |
| `filled`   | transparent           | `surface-container-high` | search boxes, composers, toolbar filters — anywhere a hairline would be the loudest line on screen       |
| `plain`    | transparent           | none                     | inline editors that must sit on the same axis as the text they replace (a row title you click to rename) |

Every variant renders a 1px border; `filled` and `plain` make it transparent. So a `filled` field
and an `outlined` field side by side are the same box to the pixel, and changing a field's variant
never shifts its neighbours.

### MD3 reference and deviations

`tokens/_md-comp-outlined-text-field.scss`: `outline-width 1px`, `focus-outline-width 2px`,
`container-shape corner-extra-small` (4dp), leading/trailing/top/bottom space `16px`,
`icon-input-space 16px`, leading and trailing icon `24px`, label and input text `body-large`.

Docket keeps the 1px resting outline and expresses MD3's 2px focus outline as the shared
`focusRing` (`ring-2 ring-ring`), so a field's focus treatment is identical to a button's rather
than a second focus vocabulary in one form. Radius is 8px so a field matches the chips and buttons
beside it; spacing and icon size come from the control scale rather than a fixed 16px/24px, so a
field in a dense toolbar is not phone-sized.

### API

```ts
const FIELD_VARIANTS: readonly ['outlined', 'filled', 'plain'];
type FieldVariant = 'outlined' | 'filled' | 'plain';

interface FieldSurfaceOptions {
  readonly variant?: FieldVariant; // default 'outlined'
  readonly controlSize: ControlSize; // resolve with useControlSize first
  readonly invalid?: boolean;
  readonly multiline?: boolean;
}
function fieldSurface(options: FieldSurfaceOptions): string;

interface InputProps extends Omit<React.ComponentProps<'input'>, 'size'> {
  readonly variant?: FieldVariant;
  readonly controlSize?: ControlSize;
}
function Input(props: InputProps): React.JSX.Element;

interface TextareaProps extends React.ComponentProps<'textarea'> {
  readonly variant?: FieldVariant;
  readonly controlSize?: ControlSize;
}
function Textarea(props: TextareaProps): React.JSX.Element;

interface SelectProps extends Omit<React.ComponentProps<'select'>, 'size'> {
  readonly variant?: FieldVariant;
  readonly controlSize?: ControlSize;
}
function Select(props: SelectProps): React.JSX.Element;

interface FieldProps extends Omit<React.ComponentProps<'div'>, 'title'> {
  readonly label: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly error?: string; // application-owned copy only
  readonly children: React.ReactNode;
}
function Field(props: FieldProps): React.JSX.Element;
```

`controlSize`, not `size`: `<input size>` and `<select size>` are native attributes with unrelated
meaning, and one prop name across every primitive is worth more than matching CSS on two elements.

`Field` supplies the label (`label-large`), the supporting text (`body-small`), and the gap, and
associates the label with the control implicitly — so no form has to invent its own label style.
Error copy replaces the description and is announced via `role="alert"`. Pass only copy this
application wrote; never an exception message, a provider's `error_description`, or a Problem
`detail`.

```tsx
<Field label="Project name" description="Shown in the sidebar" error={nameError}>
  <Input value={name} onChange={onChange} />
</Field>

<Input variant="filled" controlSize="sm" placeholder="Search projects" />
```

Anything needing search, per-option icons, or grouping is a `DropdownMenu`, not a `Select`.

---

## 5. Buttons

`packages/ui/src/primitives/button.tsx`

Geometry comes from the control scale; only colour is the button's own decision.

| Variant       | MD3 name      | Use for                                       |
| ------------- | ------------- | --------------------------------------------- |
| `default`     | Filled        | the one primary action on a surface           |
| `secondary`   | Filled tonal  | a secondary action that still needs weight    |
| `outline`     | Outlined      | a secondary action on a busy surface          |
| `ghost`       | Text          | tertiary actions, toolbar and row affordances |
| `link`        | Text (inline) | navigation rendered inside prose              |
| `destructive` | Filled, error | the confirm action of a destructive flow      |

MD3's **Elevated** button — the one MD3 button style carrying a shadow — is not offered.

```ts
const BUTTON_VARIANTS: readonly ['default', 'secondary', 'outline', 'ghost', 'link', 'destructive'];
type ButtonVariant = 'default' | 'secondary' | 'outline' | 'ghost' | 'link' | 'destructive';
type LegacyButtonSize = 'default' | 'sm' | 'lg' | 'icon'; // migrating away; see below

interface ButtonProps extends Omit<React.ComponentProps<'button'>, 'color'> {
  readonly variant?: ButtonVariant | null;
  readonly size?: LegacyButtonSize | null; // prefer controlSize
  readonly controlSize?: ControlSize;
  readonly iconOnly?: boolean;
  readonly asChild?: boolean;
}
function Button(props: ButtonProps): React.JSX.Element;

function buttonVariants(options?: {
  readonly variant?: ButtonVariant | null;
  readonly size?: LegacyButtonSize | null;
  readonly controlSize?: ControlSize;
  readonly className?: string;
}): string;
```

`size` is the pre-scale vocabulary, kept so existing callsites render at their exact current height
while screens migrate. It is a **name mapping onto the control scale**, not a second scale:
`default` → `lg` (36px), `sm` → `md` (32px), `lg` → `xl` (40px), `icon` → `xl` + `iconOnly`. New
code uses `controlSize` (or, better, `ControlGroup`) and `iconOnly` — under the old vocabulary "a
small icon button" was unexpressible because shape and height shared one axis.

---

## 6. Menus

`packages/ui/src/primitives/dropdown-menu.tsx`, `context-menu.tsx`, styled by the internal
`menu-styles.ts`

The menu primitive is the **`DropdownMenu` family** (and its right-click sibling `ContextMenu`).
There is no second menu component; both render byte-identically from one style source.

### MD3 reference

`tokens/_md-comp-menu.scss`: `container-elevation: level2` (a 3dp shadow — menus are the one
surface where a shadow is correct, because they float over arbitrary content),
`container-shape: corner-extra-small`, `top-space`/`bottom-space` `8px`.
`tokens/versions/v0_192/_md-comp-list.scss`: `list-item-leading-space` and `-trailing-space` `16px`,
`list-item-leading-icon-size` `24px`, `list-item-one-line-container-height` `56px`, label
`body-large`.

Docket keeps MD3's **total 16px leading inset** (8px of menu padding + 8px of row padding) and takes
row height and icon size from the `lg` control step (36px rows, 18px icons) instead of MD3's
phone-scale 56px rows and 24px icons. A 56px menu row in a desktop command surface is not a faithful
implementation of the spec — it is a spec applied to the wrong device. The container radius steps up
to `rounded-lg` so the menu reads as a container holding 8px-radius rows.

### Anatomy

`DropdownMenuContent` accepts `variant`: `'standard'` (neutral `surface-container-low`, the default)
or `'vibrant'` (high-emphasis `tertiary-container`, used sparingly). The choice is published to
every descendant row, label, and separator through context, so one prop retones the whole menu.

`DropdownMenuItem` supports the full MD3 list-item anatomy through optional props: a leading icon
(the first child), `supporting` (a quieter second line), `badge` (a trailing pill), `trailingText`
(a shortcut or meta hint), plus `DropdownMenuShortcut`. Selected rows use `secondary-container` —
MD3's selection role, the same one a navigation drawer's active indicator uses.

### The leading-icon column

MD3 reserves a leading slot on every row of a menu in which _any_ row has an icon, so labels share
one left axis instead of stair-stepping. Docket does this in CSS, keyed off the ARIA roles Radix
already emits:

```css
[role='menu']:has(> [role='menuitem'] > svg:first-child)
  > [role='menuitem']:not(:has(> svg:first-child)) {
  padding-inline-start: calc(0.5rem + 1.125rem + 0.5rem);
}
```

No menu opts in, and no row needs to know what its siblings render. Checkbox and radio rows are
excluded because they carry their own leading indicator and are already on the axis.

---

## 7. Layout

`packages/ui/src/primitives/layout.tsx`

`Stack` (vertical) and `Row` (horizontal) take a tokenised `gap` from a closed scale
(`0 | 1 | 2 | 3 | 4 | 6 | 8`) and are polymorphic via `as`.

`Toolbar` is the view-header primitive:

```ts
interface ToolbarProps extends Omit<React.HTMLAttributes<HTMLElement>, 'children'> {
  readonly leading?: React.ReactNode; // the view's own controls — tabs, lens switcher, title
  readonly trailing?: React.ReactNode; // controls that act on the view — filter, display, create
  readonly controlSize?: ControlSize;
  readonly as?: React.ElementType;
}
function Toolbar(props: ToolbarProps): React.JSX.Element;
```

A toolbar has two ends, so it has two props. There is nowhere to put a control except one edge or
the other, which makes the bunched-at-the-leading-edge layout inexpressible. Both groups are
`ControlGroup`s sharing one size, so the tabs on the left and the Display button on the right are
the same height.

```tsx
<Toolbar
  controlSize="md"
  leading={<Tabs items={lenses} />}
  trailing={
    <>
      <Chip variant="filter" icon={<Filter />}>
        Add filter
      </Chip>
      <Button variant="ghost" iconOnly aria-label="Display">
        <TuneRounded />
      </Button>
    </>
  }
/>
```

---

## 8. Borders, shadows, and interaction

### Borders

Minimise them. A tonal step on the surface ramp separates two regions without drawing a line, and
the ramp is designed for exactly that: `surface` → `surface-container-low` → `surface-container` →
`surface-container-high` → `surface-container-highest`, monotonic in both themes.

A border is justified when it is (a) a field's editable affordance, (b) a focus indicator, or (c) a
genuine semantic boundary between two things that are not in a containment relationship. Grouping
and separation are not on that list. `Card` carries no border and no shadow.

### Shadows

Only overlay surfaces — things that float over content the user can still see:

- `primitives/dialog.tsx`
- `primitives/sheet.tsx`
- `primitives/popover.tsx`
- `primitives/tooltip.tsx`
- `primitives/hover-card.tsx`
- `primitives/menu-styles.ts`, `dropdown-menu.tsx`, `context-menu.tsx`
- `apps/web/src/components/command-palette/command-palette.tsx`

That list is the enforced allow-set in `design-token-scan.ts`. A `shadow-*` utility anywhere else
fails the build. `shadow-none` is always legal — it is the assertion that there is no shadow.

### Interaction never changes size

No `hover:scale-*`, `active:scale-*`, `hover:p-*`, `group-hover:h-*`, `focus:text-lg`. Feedback is
the colour state layer plus the shared focus ring, both of which leave the box untouched. This
includes selection: a selected chip, a selected tab, and a checked menu row all keep their exact
geometry and change only colour.

`focusRing` (2px, outside) is for free-standing controls; `focusRingInset` (1px, inside) is for
dense rows where an outer ring would collide with the neighbour above.

### Minimum insets

Every control step pads at least 8px horizontally, so no control can render text or an icon flush
against its own edge at any size. A test asserts this over the whole scale.

---

## 9. Enforcement

`packages/test-utils/tests/design-policies/`

| File                          | Role                                                                                                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `design-token-scan.ts`        | the scanner: walks the TypeScript AST and matches inside string literals only, so a doc comment explaining why shadows were removed does not fail the build |
| `design-token-policy.test.ts` | the CI gate                                                                                                                                                 |
| `design-token-debt.json`      | the ratchet ledger                                                                                                                                          |
| `emit-ledger.ts`              | regenerates the ledger after a migration                                                                                                                    |

### Rules

| Rule                        | Fails on                                                                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `raw-type-utility`          | `text-xs`, `text-2xl`, `text-[13px]`, `font-semibold`, `leading-tight`, `leading-[1.1]`, `tracking-widest`, `tracking-[-0.015em]` |
| `size-changing-interaction` | `hover:scale-105`, `active:scale-[0.99]`, `group-hover:h-10`, `hover:p-3`, `focus:text-lg`                                        |
| `shadow-outside-overlay`    | any `shadow-*` outside the allow-set above                                                                                        |
| `hardcoded-color`           | `#7a5cff`, `rgb(…)`, `rgba(…)`, `hsl(…)`                                                                                          |

Legal near-misses the scanner deliberately spares: `text-on-surface-variant` (a colour token),
`shadow-none`, `text-[var(--radix-x)]` (a token reference), `hover:translate-y-0.5` (movement, not a
resize), and any static size no interaction changes.

### The ratchet

At the time this landed there were **1,394 pre-existing violations across 244 files**, 1,344 of them
raw type utilities. Failing on all of them at once would have meant a red CI that everyone building
screens in parallel would have had to disable, which is how enforcement dies. So the current state
is recorded in `design-token-debt.json` and the gate is one-way:

1. A file with **no ledger entry** must have **zero** violations. New files, and every file someone
   finishes migrating, are held to the real standard.
2. A file with a ledger entry may not **exceed** its recorded count. Debt cannot grow anywhere.
3. A file whose count reaches **zero** must be **removed** from the ledger. A finished file cannot
   keep its exemption.
4. `packages/ui/src/primitives/**` is held to zero with **no ledger entries permitted at all**. The
   design system does not get to carry debt.

The ledger is not an ignore list: under rule 3 an entry is a debt with a maturity date, and the test
collects on it. **Launch sign-off is `design-token-debt.json` being `{}`.** Progress is countable
rather than a matter of opinion:

```bash
jq '[.[] | to_entries[].value] | add' \
  packages/test-utils/tests/design-policies/design-token-debt.json
```

After migrating files, regenerate:

```bash
cd packages/test-utils && pnpm exec tsx tests/design-policies/emit-ledger.ts
```

### Proven, not assumed

The policy test scans an inline fixture containing one instance of every violation the rules are
meant to catch, asserts every rule fires, and asserts the legal near-misses do not — because a
policy test that only asserts "zero violations found" passes just as happily when its regexes match
nothing. The ratchet comparison is a pure function tested with synthetic ledgers, and the gate was
verified end-to-end by injecting `'text-[13px] font-semibold hover:scale-105 shadow-sm #ff00ff'`
into `primitives/chip.tsx` and confirming both the zero-tolerance test and the ratchet test failed
with all four rules named, then reverting.

The compile-time guarantee is checked the same way: `packages/ui/tests/primitives/design-contract.test.tsx`
contains a `@ts-expect-error` on `<Chip>No priority</Chip>`, so if an icon-less chip ever becomes
writable, `pnpm typecheck` fails.

---

## 10. Migration checklist for a screen

1. Wrap every toolbar in `Toolbar` with explicit `leading` and `trailing` groups. Delete the bare
   `<div className="flex items-center gap-2">`.
2. Wrap every other run of inline controls in `ControlGroup`. Delete every `h-*` on a control.
3. Replace every pill with `Chip` (pressable) or `Badge` (readable). Give each chip a leading icon,
   an avatar, or a named exemption.
4. Replace every raw `<input>`, `<textarea>`, and `<select>` with `Input`, `Textarea`, `Select`.
   Wrap each in `Field` for its label.
5. Replace every raw type utility with a `text-<role>` token or the `Text` primitive. There are
   fifteen roles; one of them is right.
6. Delete every `shadow-*` that is not on an overlay, and every border that only groups.
7. Delete every `hover:scale-*` / `active:scale-*`.
8. Run `pnpm exec tsx tests/design-policies/emit-ledger.ts` from `packages/test-utils` and confirm
   your files left the ledger.
