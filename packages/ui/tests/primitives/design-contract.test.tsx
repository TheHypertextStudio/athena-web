import '@testing-library/jest-dom/vitest';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import type * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from '../../src/primitives/button';
import { Chip } from '../../src/primitives/chip';
import {
  CONTROL,
  CONTROL_SIZES,
  ControlGroup,
  type ControlSize,
  controlChrome,
  DEFAULT_CONTROL_SIZE,
  useControlMetrics,
} from '../../src/primitives/control';
import { FIELD_VARIANTS, Field, Input, Select, Textarea } from '../../src/primitives/field';
import { Toolbar } from '../../src/primitives/layout';
import {
  DEFAULT_MENU_SECTIONS,
  MENU_INDICATOR_GUTTER,
  MENU_METRICS,
  type MenuVariant,
  menuCheckedItemClass,
  menuContentClass,
  menuFocusRing,
  menuGroup,
  menuItemClass,
  menuLabel,
  menuSeparator,
  menuSupporting,
  menuTrailingText,
} from '../../src/primitives/menu-styles';
import { TYPE_TOKENS, Text, typeClass } from '../../src/primitives/text';

const GLOBALS_CSS = readFileSync(
  resolve(import.meta.dirname, '../../src/styles/globals.css'),
  'utf8',
);

describe('control-height scale', () => {
  it('steps 4px apart with no gaps, so two adjacent steps are never confusable', () => {
    const heights = CONTROL_SIZES.map((size) => CONTROL[size].heightPx);
    expect(heights).toEqual([24, 28, 32, 36, 40]);
  });

  it('keeps every step above the 8px minimum text inset', () => {
    // The launch bar's inset floor. A control whose padding drops below it renders text touching
    // its own edge, which is the finding this scale exists to make structurally impossible.
    for (const size of CONTROL_SIZES) {
      expect(CONTROL[size].paddingXPx, `${size} padding`).toBeGreaterThanOrEqual(8);
    }
  });

  it('agrees with the --control-h-* custom properties in globals.css', () => {
    // The TypeScript table and the CSS custom properties are two mirrors of one scale. `--row-h`
    // and DENSITY_ROW_HEIGHT already proved that two mirrors with no test between them drift.
    for (const size of CONTROL_SIZES) {
      const declaration = new RegExp(`--control-h-${size}:\\s*([\\d.]+)rem`).exec(GLOBALS_CSS);
      expect(declaration, `--control-h-${size} must be declared in globals.css`).not.toBeNull();
      expect(Number(declaration?.[1]) * 16, `--control-h-${size}`).toBe(CONTROL[size].heightPx);
    }
  });

  it('emits a height, a padding, and an icon size for every step', () => {
    for (const size of CONTROL_SIZES) {
      const chrome = controlChrome(size);
      expect(chrome, size).toContain(CONTROL[size].height);
      expect(chrome, size).toContain(CONTROL[size].paddingX);
      expect(chrome, size).toContain(CONTROL[size].iconApply);
      expect(chrome, size).toContain(typeClass(CONTROL[size].labelToken));
    }
  });

  it('never renders a shadow or a size-changing interaction state', () => {
    for (const size of CONTROL_SIZES) {
      const chrome = controlChrome(size);
      expect(chrome, size).not.toMatch(/\bshadow-/);
      expect(chrome, size).not.toMatch(/(?:hover|active|focus):(?:scale|size|p|h|w)-/);
    }
  });

  it('swaps padding for a fixed width when the control is icon-only', () => {
    const chrome = controlChrome('md', { iconOnly: true });
    expect(chrome).toContain('w-8');
    expect(chrome).toContain('px-0');
    expect(chrome).not.toContain('px-3');
  });

  it('swaps a fixed height for a minimum height when the control is growable', () => {
    // `toContain` is a substring check and `min-h-8` contains `h-8`, so classes are compared as a
    // token set rather than by substring.
    const classes = controlChrome('md', { growable: true }).split(/\s+/);
    expect(classes).toContain(CONTROL.md.minHeight);
    expect(classes).not.toContain(CONTROL.md.height);
  });

  it('useControlMetrics resolves the full metric set for the requested (or ambient) step', () => {
    const { result } = renderHook(() => useControlMetrics('lg'));
    expect(result.current).toEqual(CONTROL.lg);
  });
});

describe('ControlGroup', () => {
  it('gives every control in the group the same height class', () => {
    render(
      <ControlGroup controlSize="sm" data-testid="group">
        <Button>Save</Button>
        <Chip icon={<svg />}>Priority</Chip>
        <Input aria-label="Search" />
        <Select aria-label="Display">
          <option>List</option>
        </Select>
      </ControlGroup>,
    );

    const expected = CONTROL.sm.height;
    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass(expected);
    expect(screen.getByRole('button', { name: 'Priority' })).toHaveClass(expected);
    expect(screen.getByLabelText('Search')).toHaveClass(expected);
    expect(screen.getByLabelText('Display')).toHaveClass(expected);
  });

  it('falls back to one shared default when there is no group', () => {
    render(
      <>
        <Button>Bare</Button>
        <Chip icon={<svg />}>Bare chip</Chip>
        <Input aria-label="Bare field" />
      </>,
    );
    const expected = CONTROL[DEFAULT_CONTROL_SIZE].height;
    expect(screen.getByRole('button', { name: 'Bare' })).toHaveClass(expected);
    expect(screen.getByRole('button', { name: 'Bare chip' })).toHaveClass(expected);
    expect(screen.getByLabelText('Bare field')).toHaveClass(expected);
  });

  it('lets a control override the group, and nests groups', () => {
    render(
      <ControlGroup controlSize="xl">
        <Button controlSize="xs">Override</Button>
        <ControlGroup>
          <Button>Inherited</Button>
        </ControlGroup>
      </ControlGroup>,
    );
    expect(screen.getByRole('button', { name: 'Override' })).toHaveClass(CONTROL.xs.height);
    expect(screen.getByRole('button', { name: 'Inherited' })).toHaveClass(CONTROL.xl.height);
  });

  it('lays out vertically and allows wrapping when asked', () => {
    render(
      <ControlGroup orientation="vertical" wrap data-testid="vgroup">
        <Button>A</Button>
      </ControlGroup>,
    );
    const group = screen.getByTestId('vgroup');
    expect(group).toHaveClass('flex-col', 'items-stretch', 'flex-wrap');
    expect(group).not.toHaveClass('flex-row');
  });

  it('preserves every legacy Button size name at its original pixel height', () => {
    // The legacy names map onto the scale; none of them may change what already ships.
    const cases: [NonNullable<React.ComponentProps<typeof Button>['size']>, ControlSize][] = [
      ['default', 'lg'],
      ['sm', 'md'],
      ['lg', 'xl'],
      ['icon', 'xl'],
    ];
    for (const [legacy, step] of cases) {
      const { unmount } = render(<Button size={legacy}>{legacy}</Button>);
      expect(screen.getByRole('button', { name: legacy }), legacy).toHaveClass(
        CONTROL[step].height,
      );
      unmount();
    }
  });
});

describe('Toolbar', () => {
  it('pushes the leading and trailing groups to opposite edges', () => {
    const { container } = render(
      <Toolbar leading={<Button>List</Button>} trailing={<Button>Display</Button>} />,
    );
    const root = container.firstElementChild;
    expect(root).toHaveClass('justify-between');
    expect(root?.children).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'List' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Display' })).toBeInTheDocument();
  });

  it('gives both ends the same control size', () => {
    render(
      <Toolbar
        controlSize="sm"
        leading={<Button>Leading</Button>}
        trailing={<Button>Trailing</Button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Leading' })).toHaveClass(CONTROL.sm.height);
    expect(screen.getByRole('button', { name: 'Trailing' })).toHaveClass(CONTROL.sm.height);
  });
});

describe('Chip', () => {
  it('renders a leading icon and MD3 chip geometry, not a pill', () => {
    render(
      <Chip icon={<svg data-testid="glyph" />} controlSize="md">
        No priority
      </Chip>,
    );
    const chip = screen.getByRole('button', { name: 'No priority' });
    expect(screen.getByTestId('glyph')).toBeInTheDocument();
    // MD3 `corner-small` = 8dp, which is `rounded-md` here. `rounded-full` belongs to badges.
    expect(chip).toHaveClass('rounded-md');
    expect(chip).not.toHaveClass('rounded-full');
    expect(chip).toHaveClass(CONTROL.md.height);
  });

  it('keeps identical geometry across variants, tones, and selection', () => {
    const geometry = [CONTROL.md.height, CONTROL.md.paddingX, CONTROL.md.gap, 'rounded-md'];
    const cases = [
      <Chip key="a" icon={<svg />} variant="assist">
        assist
      </Chip>,
      <Chip key="b" icon={<svg />} variant="filter" selected>
        filter
      </Chip>,
      <Chip key="c" icon={<svg />} variant="suggestion" tone="outlined">
        suggestion
      </Chip>,
      <Chip key="d" leadingNone="overflow-count">
        overflow
      </Chip>,
    ];
    for (const element of cases) {
      const { unmount } = render(element);
      const chip = screen.getByRole('button');
      for (const cls of geometry) expect(chip, chip.textContent).toHaveClass(cls);
      unmount();
    }
  });

  it('swaps the filter chip glyph on selection instead of inserting one', () => {
    const { rerender } = render(
      <Chip variant="filter" icon={<svg data-testid="own-glyph" />}>
        Assigned to me
      </Chip>,
    );
    const unselected = screen.getByRole('button');
    expect(screen.getByTestId('own-glyph')).toBeInTheDocument();
    expect(unselected).toHaveAttribute('aria-pressed', 'false');
    const unselectedClasses = unselected.className;

    rerender(
      <Chip variant="filter" icon={<svg data-testid="own-glyph" />} selected>
        Assigned to me
      </Chip>,
    );
    const selected = screen.getByRole('button');
    expect(selected).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('own-glyph')).not.toBeInTheDocument();

    // Selection changes colour only. Height, padding, gap, and radius are untouched, so toggling a
    // filter cannot reflow the row it sits in.
    for (const cls of [CONTROL.md.height, CONTROL.md.paddingX, CONTROL.md.gap, 'rounded-md']) {
      expect(unselectedClasses).toContain(cls);
      expect(selected).toHaveClass(cls);
    }
  });

  it('records the named exemption when a chip deliberately has no leading element', () => {
    render(<Chip leadingNone="md3-suggestion-chip">Try a template</Chip>);
    expect(screen.getByRole('button')).toHaveAttribute(
      'data-leading-exemption',
      'md3-suggestion-chip',
    );
  });

  it('renders a removable input chip as two actions inside one container', () => {
    render(
      <Chip variant="input" avatar={<svg />} onRemove={() => undefined} removeLabel="Remove Alex">
        Alex Kim
      </Chip>,
    );
    expect(screen.getByRole('button', { name: 'Remove Alex' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Alex Kim' })).toBeInTheDocument();
  });

  it('fires onRemove and keeps the box size on a selected removable chip', () => {
    const onRemove = vi.fn();
    render(
      <Chip variant="input" avatar={<svg />} selected onRemove={onRemove} removeLabel="Remove Alex">
        Alex Kim
      </Chip>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove Alex' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    // Selection changes colour only; the transparent border keeps the same box size.
    expect(screen.getByRole('button', { name: 'Alex Kim' }).parentElement).toHaveClass(
      'bg-secondary-container',
      'border-transparent',
    );
  });

  it('renders chip styling onto a single child element via asChild', () => {
    render(
      <Chip asChild icon={<svg data-testid="glyph" />}>
        <a href="/projects/1">Open project</a>
      </Chip>,
    );
    const link = screen.getByRole('link', { name: 'Open project' });
    expect(link).toHaveClass('rounded-md', CONTROL.md.height);
    expect(screen.getByTestId('glyph')).toBeInTheDocument();
  });

  it('never renders a shadow', () => {
    const { container } = render(<Chip icon={<svg />}>Chip</Chip>);
    expect(container.innerHTML).not.toMatch(/\bshadow-/);
  });
});

/**
 * Compile-time proof that an icon-less chip cannot be written by accident.
 *
 * @remarks
 * `@ts-expect-error` inverts the usual assertion: if the expression below ever *does* type-check,
 * the directive itself becomes a TypeScript error and `pnpm typecheck` fails. So the guarantee is
 * checked by the compiler on every run rather than described in a comment. It is deliberately not
 * rendered — the point is that this code cannot be written, not what it would do if it were.
 */
function chipLeadingElementIsRequired(): React.ReactNode {
  // @ts-expect-error a chip must supply `icon`, `avatar`, or a named `leadingNone` exemption
  return <Chip>No priority</Chip>;
}
void chipLeadingElementIsRequired;

describe('field family', () => {
  it('renders every variant with the same box so swapping one cannot shift its neighbours', () => {
    for (const variant of FIELD_VARIANTS) {
      const { unmount } = render(<Input variant={variant} aria-label={variant} controlSize="md" />);
      const input = screen.getByLabelText(variant);
      expect(input, variant).toHaveClass(CONTROL.md.height);
      expect(input, variant).toHaveClass('rounded-md');
      // Every variant carries a border; `filled` and `plain` simply make it transparent.
      expect(input.className, variant).toMatch(/\bborder\b/);
      unmount();
    }
  });

  it('renders no shadow in any variant', () => {
    for (const variant of FIELD_VARIANTS) {
      const { unmount } = render(<Input variant={variant} aria-label={variant} />);
      expect(screen.getByLabelText(variant).className, variant).not.toMatch(/\bshadow-/);
      unmount();
    }
  });

  it('shares one recipe across input, textarea, and select', () => {
    render(
      <ControlGroup controlSize="lg">
        <Input aria-label="text" />
        <Textarea aria-label="notes" />
        <Select aria-label="choice">
          <option>a</option>
        </Select>
      </ControlGroup>,
    );
    // The textarea grows, so it takes the step as a minimum rather than a fixed height.
    expect(screen.getByLabelText('text')).toHaveClass(CONTROL.lg.height);
    expect(screen.getByLabelText('notes')).toHaveClass(CONTROL.lg.minHeight);
    expect(screen.getByLabelText('choice')).toHaveClass(CONTROL.lg.height);
    for (const label of ['text', 'notes', 'choice']) {
      expect(screen.getByLabelText(label), label).toHaveClass('rounded-md');
    }
  });

  it('associates the Field label with its control and shows error copy over the description', () => {
    const { rerender } = render(
      <Field label="Project name" description="Shown in the sidebar">
        <Input />
      </Field>,
    );
    expect(screen.getByLabelText('Project name')).toBeInTheDocument();
    expect(screen.getByText('Shown in the sidebar')).toBeInTheDocument();

    rerender(
      <Field label="Project name" description="Shown in the sidebar" error="Enter a name">
        <Input />
      </Field>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a name');
    expect(screen.queryByText('Shown in the sidebar')).not.toBeInTheDocument();
  });

  it('renders neither description nor error text when both are omitted', () => {
    const { container } = render(
      <Field label="Project name">
        <Input />
      </Field>,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // Only the <label> renders inside the field column — no empty supporting-text row beneath it.
    expect(container.firstElementChild?.children).toHaveLength(1);
  });

  it('marks the field invalid with the error border when aria-invalid is set', () => {
    render(<Input aria-label="Due date" aria-invalid />);
    const input = screen.getByLabelText('Due date');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveClass('border-error');
  });
});

describe('type scale', () => {
  it('exposes exactly the fifteen MD3 roles', () => {
    expect(TYPE_TOKENS).toHaveLength(15);
    for (const token of TYPE_TOKENS) {
      expect(typeClass(token)).toBe(`text-${token}`);
    }
  });

  it('declares every role as a --text-* theme token in globals.css', () => {
    // A role the primitive offers but the stylesheet never defines renders at the inherited size —
    // silently, and only in the browser.
    for (const token of TYPE_TOKENS) {
      expect(GLOBALS_CSS, token).toContain(`--text-${token}:`);
      expect(GLOBALS_CSS, token).toContain(`--text-${token}--line-height:`);
      expect(GLOBALS_CSS, token).toContain(`--text-${token}--font-weight:`);
    }
  });

  it('renders one type class and one tone class, and nothing else', () => {
    render(
      <Text token="body-small" tone="muted" numeric truncate data-testid="t">
        3 hours ago
      </Text>,
    );
    const node = screen.getByTestId('t');
    expect(node).toHaveClass('text-body-small', 'text-on-surface-variant', 'tabular-nums');
    expect(node.className).not.toMatch(/\bfont-(?:medium|semibold|bold)\b/);
  });

  it('renders the requested element so the document outline is independent of the type role', () => {
    render(
      <Text as="h3" token="label-medium">
        Section
      </Text>,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Section' })).toBeInTheDocument();
  });
});

/*
 * The MD3 Expressive vertical-menu contract.
 *
 * The class strings in `menu-styles.ts` have to stay literal for Tailwind's static extractor,
 * so a number written there answers to nothing unless something checks it. These assertions are
 * that check, and each one names the `md.comp.menus.*` token it enforces. The values are
 * transcribed in `docs/design/references/md3-menus.md`; change that file first, then these.
 *
 * This block used to be two assertions — row height and icon size, both pointed at `CONTROL.lg`
 * rather than at the spec — which is how the primitive came to sit 8px short on row height, 2px
 * short on icons, one type role off on the label, and on the wrong colour role entirely for
 * selection, without a single test going red. `CORE-08` in launch-compliance.md is that gap.
 */
describe('MD3 menu spec — layout and shape', () => {
  it('sizes the row from the spec rather than from the control scale', () => {
    // menu-item.height 44dp; leading/trailing-space 16dp; top/bottom-space 8dp;
    // between-space 12dp; leading/trailing-icon.size 20dp.
    expect(MENU_METRICS.minHeightPx).toBe(44);
    expect(MENU_METRICS.paddingXPx).toBe(16);
    expect(MENU_METRICS.paddingYPx).toBe(8);
    expect(MENU_METRICS.gapPx).toBe(12);
    expect(MENU_METRICS.iconPx).toBe(20);

    const row = menuItemClass('standard');
    expect(row).toContain(MENU_METRICS.minHeight);
    expect(row).toContain(MENU_METRICS.paddingX);
    expect(row).toContain(MENU_METRICS.paddingY);
    expect(row).toContain(MENU_METRICS.gap);
    expect(row).toContain(MENU_METRICS.iconApply);
  });

  it('gives the container corner.large and the 4dp padding that produces the edge-row corner', () => {
    // container.shape corner.large 16dp, and 16 - 4 = the 12dp first/last-child outer corner.
    expect(menuContentClass('standard')).toContain('rounded-corner-lg');
    expect(menuContentClass('standard')).toContain(MENU_METRICS.containerPadding);
    expect(MENU_METRICS.containerPaddingPx).toBe(4);
  });

  it('morphs the container to corner.small while one of its submenus is open', () => {
    // active.container.shape corner.large / inactive.container.shape corner.small. Radix portals
    // SubContent out, so an open SubTrigger with data-state="open" stays inside this element.
    expect(menuContentClass('standard')).toContain('has-data-[state=open]:rounded-corner-sm');
  });

  it('shapes rows corner.extra-small, edge rows corner.medium, and selected rows corner.medium', () => {
    // menu-item.shape 4dp; first/last-child.shape 12dp with a 4dp inner corner;
    // menu-item.selected.shape 12dp.
    const row = menuItemClass('standard');
    expect(row).toContain('rounded-corner-xs');
    expect(menuItemClass('standard', { selected: true })).toContain('rounded-corner-md');
    // The 12dp edge corner belongs to whichever element owns the padded surface, because "is this
    // row on the menu's outer edge?" is not a question the row can answer: at a seam in a gapped
    // menu it is its block's last child and is not on the edge at all.
    expect(row).not.toContain('first:rounded-t-corner-md');
    expect(menuContentClass('standard', 'md', 'divider')).toContain(
      '[&>[role^=menuitem]:first-child]:rounded-t-corner-md',
    );
  });

  it('stacks rows 2dp apart, which is what gives a row its corner in the first place', () => {
    // md.comp.menus.gap = space25 = 2dp, between EVERY row rather than only between sections.
    // The measurements figure's 48dp row bracket is 44dp of menu-item.height plus that gap top
    // and bottom. A flush list would not need a 4dp corner on each row.
    expect(menuContentClass('standard')).toContain('gap-0.5');
    expect(menuContentClass('standard')).toContain('flex flex-col');
    // Rows inside a section keep the 2dp token; whole sections are separated by the wider step.
    expect(menuGroup('standard', 'gap')).toContain('gap-0.5');
    expect(menuContentClass('standard', 'md', 'gap')).toContain('gap-1');
  });

  it('paints each section as its own filled block under the gap layout', () => {
    // This is the whole effect: the container stops painting, every group paints instead, and the
    // surface behind the menu shows through between them. A transparent wrapper with a 2dp margin
    // renders nothing, which is what this was.
    const grouped = menuGroup('standard', 'gap');
    expect(grouped).toContain('bg-surface-container-low');
    expect(grouped).toContain('shadow-level2');
    expect(grouped).toContain('gap-0.5');
    // A group is the container's surface repeated per section, so rows keep the same 4dp inset
    // they have under the divider layout. The gap is the only difference between the two.
    expect(grouped).toContain('p-1');
    expect(grouped).toContain(MENU_METRICS.containerPadding);
  });

  it('rounds a group tighter at the seam than at the menu edge', () => {
    // group.shape corner.small (8dp) on the edges facing a gap; container.shape corner.large
    // (16dp) where the group IS the menu's outer boundary. Uniform corners would read as two
    // separate menus stacked, rather than as one menu cut in two.
    const grouped = menuGroup('standard', 'gap');
    expect(grouped).toContain('rounded-corner-sm');
    expect(grouped).toContain('first:rounded-t-corner-lg');
    expect(grouped).toContain('last:rounded-b-corner-lg');
    // 16dp outer less the 4dp inset is the 12dp the outermost rows take; 8dp at the seam less the
    // same inset is 4dp, which is the row's own shape and why a seam row needs no override.
    expect(grouped).toContain('first:[&>[role^=menuitem]:first-child]:rounded-t-corner-md');
    expect(grouped).toContain('last:[&>[role^=menuitem]:last-child]:rounded-b-corner-md');
    expect(menuGroup('vibrant', 'gap')).toContain('bg-tertiary-container');
  });

  it('hands the container fill to the groups rather than letting both paint', () => {
    const container = menuContentClass('standard', 'md', 'gap');
    expect(container).toContain('bg-transparent');
    expect(container).not.toContain('shadow-level2');
    expect(container).not.toContain('bg-surface-container-low');
    // The divider layout is the inverse: the container paints and a group is a bare wrapper.
    expect(menuContentClass('standard', 'md', 'divider')).toContain('bg-surface-container-low');
    expect(menuContentClass('standard', 'md', 'divider')).toContain('shadow-level2');
  });

  it('keeps a semantic group out of the divider layout entirely', () => {
    // A group still has to exist for screen readers, but as a box it would swallow the
    // container's 2dp row gap and leave its rows flush. `display: contents` drops it from the
    // layout tree so the rows rejoin the container's flex flow.
    expect(menuGroup('standard', 'divider')).toBe('contents');

    // Selectors read the DOM tree rather than the layout tree, so `display: contents` does not
    // make the group transparent to `:first-child`. The edge-corner rule has to walk through it,
    // or the top and bottom rows of a grouped menu lose their 12dp concentric corner and read as
    // 4dp pills against a 16dp container.
    const container = menuContentClass('standard', 'md', 'divider');
    expect(container).toContain(
      '[&>[role=group]:first-child>[role^=menuitem]:first-child]:rounded-t-corner-md',
    );
    expect(container).toContain(
      '[&>[role=group]:last-child>[role^=menuitem]:last-child]:rounded-b-corner-md',
    );
  });

  it('defaults to the divider layout', () => {
    expect(DEFAULT_MENU_SECTIONS).toBe('divider');
    expect(menuContentClass('standard')).toBe(menuContentClass('standard', 'md', 'divider'));
  });

  it('takes container.elevation from the MD3 level scale, not a Tailwind shadow', () => {
    expect(menuContentClass('standard')).toContain('shadow-level2');
    expect(menuContentClass('standard')).not.toMatch(/shadow-(sm|md|lg|xl|2xl)\b/);
    expect(GLOBALS_CSS).toContain('--shadow-level2:');
  });

  it('labels rows label-large and trailing text label-large, not a smaller role', () => {
    // menu-item.label-text and .trailing-supporting-text are both label-large;
    // .supporting-text is body-small.
    expect(MENU_METRICS.labelToken).toBe('label-large');
    expect(menuItemClass('standard')).toContain('text-label-large');
    expect(menuTrailingText('standard')).toContain('text-label-large');
    expect(menuSupporting('standard')).toContain('text-body-small');
  });

  it('reserves one leading column across icon rows, bare rows, and checkable rows', () => {
    // 16dp leading space + 20dp icon + 12dp between-space = 48px, and the indicator gutter a
    // checkbox or radio row reserves has to be the same figure or the labels stair-step.
    expect(MENU_INDICATOR_GUTTER).toBe('pl-12');
    expect(GLOBALS_CSS).toContain("[role='menu']:has([role='menuitem'] > svg:first-child)");
    expect(GLOBALS_CSS).toContain('padding-inline-start: calc(1rem + 1.25rem + 0.75rem)');
  });

  it('draws the 3dp inset focus indicator the spec calls for, not the 1px row ring', () => {
    // focus.indicator.thickness 3dp, .outline.offset -3dp, .color secondary (--ring).
    expect(menuFocusRing).toContain('focus-visible:ring-[3px]');
    expect(menuFocusRing).toContain('focus-visible:ring-inset');
    expect(menuFocusRing).toContain('focus-visible:ring-ring');
    expect(GLOBALS_CSS).toContain('--ring: var(--secondary)');
  });
});

describe('MD3 menu spec — standard colour mapping', () => {
  it('maps the container and default content to the surface roles', () => {
    const content = menuContentClass('standard');
    expect(content).toContain('bg-surface-container-low');
    expect(content).toContain('text-on-surface');
  });

  it('quiets both icons to on-surface-variant, a step below the label', () => {
    // menu-item.leading-icon.color and .trailing-icon.color are both on-surface-variant.
    expect(menuItemClass('standard')).toContain('[&_svg]:text-on-surface-variant');
  });

  it('selects into tertiary-container, which is the expressive role and not the baseline one', () => {
    // menu-item.selected.container.color tertiary-container. The baseline menu says
    // secondary-container; that is the legacy spec and is the value this drifted onto.
    const selected = menuItemClass('standard', { selected: true });
    expect(selected).toContain('bg-tertiary-container');
    expect(selected).toContain('text-on-tertiary-container');
    expect(selected).not.toContain('bg-secondary-container');
  });

  it('separates hover, focus, and pressed into three distinct state layers', () => {
    // hover 0.08, focus 0.10, pressed 0.10 — and focus is scoped away from hover because Radix
    // drives roving focus on pointer move, so an unguarded focus layer swallows every hover.
    const row = menuItemClass('standard');
    expect(row).toContain('hover:bg-on-surface/8');
    expect(row).toContain('focus:not-hover:bg-on-surface/10');
    expect(row).toContain('active:bg-on-surface/10');
  });

  it('disables at 0.38, the opacity every MD3 disabled token carries', () => {
    expect(menuItemClass('standard')).toContain('data-[disabled]:opacity-38');
    expect(menuItemClass('standard')).not.toContain('opacity-50');
  });

  it('draws the divider in the Divider component role, not the baseline menu one', () => {
    // Neither expressive colour set publishes a divider token, so the role comes from
    // md.comp.divider.color = outline-variant. The baseline menu's surface-variant is legacy.
    expect(menuSeparator('standard')).toContain('bg-outline-variant');
    expect(menuSeparator('standard')).toContain('h-px');
    expect(menuSeparator('standard')).not.toContain('surface-variant"');
  });

  it('tones section labels and supporting content to on-surface-variant', () => {
    expect(menuLabel('standard')).toContain('text-on-surface-variant');
    expect(menuSupporting('standard')).toContain('text-on-surface-variant');
    expect(menuTrailingText('standard')).toContain('text-on-surface-variant');
  });
});

describe('MD3 menu spec — vibrant colour mapping', () => {
  it('builds the whole surface out of the tertiary container roles', () => {
    const content = menuContentClass('vibrant');
    expect(content).toContain('bg-tertiary-container');
    expect(content).toContain('text-on-tertiary-container');
  });

  it('escalates selection to solid tertiary', () => {
    const selected = menuItemClass('vibrant', { selected: true });
    expect(selected).toContain('bg-tertiary');
    expect(selected).toContain('text-on-tertiary');
  });

  it('shifts icons to tertiary on interaction while the label holds still', () => {
    // The one mapping where the icon colour moves: on-tertiary-container enabled, tertiary on
    // hover, focus, and press.
    const row = menuItemClass('vibrant');
    expect(row).toContain('[&_svg]:text-on-tertiary-container');
    expect(row).toContain('hover:[&_svg]:text-tertiary');
    expect(row).toContain('focus:[&_svg]:text-tertiary');
    expect(row).toContain('active:[&_svg]:text-tertiary');
    expect(row).toContain('text-on-tertiary-container');
  });

  it('runs the same 8/10/10 state layers, in the tertiary on-role', () => {
    const row = menuItemClass('vibrant');
    expect(row).toContain('hover:bg-on-tertiary-container/8');
    expect(row).toContain('focus:not-hover:bg-on-tertiary-container/10');
    expect(row).toContain('active:bg-on-tertiary-container/10');
  });

  it('keeps the divider inside the tertiary family rather than on a neutral outline', () => {
    // outline-variant is a neutral-variant role and the Divider component assumes a neutral
    // surface; on tertiary-container it is a grey hairline belonging to no tonal family.
    expect(menuSeparator('vibrant')).toContain('bg-on-tertiary-container/20');
    expect(menuSeparator('vibrant')).not.toContain('outline-variant');
  });

  it('mixes a selected row state layer into its own container, not into the menu behind it', () => {
    // A state layer is the on-role over the component's container. An alpha fill would let the
    // menu surface show through the selection, which is a different colour than the spec names.
    const selected = menuItemClass('vibrant', { selected: true });
    expect(selected).toContain('color-mix(in_oklab,var(--on-tertiary)_8%,var(--tertiary))');
    expect(selected).toContain('color-mix(in_oklab,var(--on-tertiary)_10%,var(--tertiary))');
  });
});

describe('MD3 menu spec — both mappings render from one source', () => {
  it.each<MenuVariant>(['standard', 'vibrant'])(
    'gives the %s mapping the same geometry',
    (variant) => {
      // Deduplication is the point: the two mappings differ in colour and in nothing else.
      const row = menuItemClass(variant);
      expect(row).toContain(MENU_METRICS.minHeight);
      expect(row).toContain(MENU_METRICS.paddingX);
      expect(row).toContain(MENU_METRICS.paddingY);
      expect(row).toContain(MENU_METRICS.gap);
      expect(row).toContain(MENU_METRICS.iconApply);
      expect(row).toContain('rounded-corner-xs');
      expect(menuContentClass(variant)).toContain('rounded-corner-lg');
      expect(menuContentClass(variant)).toContain('shadow-level2');
    },
  );

  it('gives the checked-row escalation the same roles the selected-row builder does', () => {
    // A radio row cannot supply `selected` as a boolean — Radix publishes it only as an
    // attribute — so the two builders have to agree or checkbox and radio rows diverge.
    expect(menuCheckedItemClass('standard')).toContain(
      'data-[state=checked]:bg-tertiary-container',
    );
    expect(menuCheckedItemClass('standard')).toContain('data-[state=checked]:rounded-corner-md');
    expect(menuCheckedItemClass('vibrant')).toContain('data-[state=checked]:bg-tertiary');
  });

  it('draws no border on the container — MD3 separates a menu with elevation and tone', () => {
    // The spec's colour list for menus has 11 elements and no outline role among them.
    expect(menuContentClass('standard')).not.toMatch(/(?:^|\s)border(?:\s|$)/);
    expect(menuContentClass('vibrant')).not.toMatch(/(?:^|\s)border(?:\s|$)/);
  });
});

describe('label palette', () => {
  /** The palette keys `LabelChip` will ask the stylesheet to resolve. */
  const LABEL_KEYS = [
    'blue',
    'indigo',
    'violet',
    'plum',
    'pink',
    'coral',
    'amber',
    'green',
    'teal',
    'slate',
  ] as const;

  const ROLES = ['dot', 'container', 'on-container'] as const;

  /** The dark-theme block, where a key added only to `:root` would go missing. */
  const DARK_BLOCK = GLOBALS_CSS.slice(GLOBALS_CSS.indexOf('@media (prefers-color-scheme: dark)'));

  it('declares all three roles for every key', () => {
    // A key missing a role renders the chip with an inherited background — invisible in tests,
    // visible only as an unreadable chip in the browser.
    for (const key of LABEL_KEYS) {
      for (const role of ROLES) {
        expect(GLOBALS_CSS, `${key} ${role}`).toContain(`--label-${key}-${role}:`);
      }
    }
  });

  it('re-declares every key in the dark theme', () => {
    // This is the invariant that silently breaks: someone adds an eleventh hue to `:root`,
    // forgets the dark block, and the chip inherits the light tint on a dark surface. A stored
    // hex had exactly this failure mode, which is why colours became keys in the first place.
    for (const key of LABEL_KEYS) {
      for (const role of ROLES) {
        expect(DARK_BLOCK, `${key} ${role} (dark)`).toContain(`--label-${key}-${role}:`);
      }
    }
  });

  it('maps every key through a data-label-color rule', () => {
    // The component emits the key as an attribute; without a matching rule it falls through to
    // the `:root` neutral and every label in the product renders grey.
    for (const key of LABEL_KEYS) {
      expect(GLOBALS_CSS, key).toContain(`[data-label-color='${key}']`);
    }
  });

  it('gives the resolved variables a neutral fallback at :root', () => {
    // A label mirrored from a connected tool still carries that provider's hex. It must render
    // as the quiet neutral, not as nothing.
    for (const role of ROLES) {
      expect(GLOBALS_CSS, role).toContain(`--label-${role}: var(--label-slate-${role})`);
    }
  });
});
