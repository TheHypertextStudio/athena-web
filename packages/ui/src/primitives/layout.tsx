/**
 * `@docket/ui` — `Stack` / `Row` layout primitives.
 *
 * @remarks
 * Flex containers with a tokenized `gap` (and alignment) so structural layout composes from named
 * components instead of repeated inline `flex flex-col gap-*` / `flex items-center justify-*` strings.
 * Both are polymorphic via `as` (default `div`), so they can be a `section`, `header`, `ul`, `nav`,
 * etc. without losing semantics. Extra `className` is merged last, so one-off tweaks still work.
 *
 * @example
 * ```tsx
 * <Stack gap={3}>…</Stack>
 * <Row as="header" justify="between" className="px-3">…</Row>
 * ```
 */
import { type VariantProps, cva } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../lib/utils';
import { ControlGroup, type ControlSize } from './control';

/** The shared `gap` scale (Tailwind gap-* steps). Keep small and intentional. */
const GAP = {
  0: 'gap-0',
  1: 'gap-1',
  2: 'gap-2',
  3: 'gap-3',
  4: 'gap-4',
  6: 'gap-6',
  8: 'gap-8',
} as const;

const stackVariants = cva('flex min-w-0 flex-col', {
  variants: {
    gap: GAP,
    align: {
      start: 'items-start',
      center: 'items-center',
      end: 'items-end',
      stretch: 'items-stretch',
    },
  },
  defaultVariants: { gap: 0 },
});

const rowVariants = cva('flex min-w-0 flex-row', {
  variants: {
    gap: GAP,
    align: {
      start: 'items-start',
      center: 'items-center',
      end: 'items-end',
      baseline: 'items-baseline',
      stretch: 'items-stretch',
    },
    justify: {
      start: 'justify-start',
      center: 'justify-center',
      end: 'justify-end',
      between: 'justify-between',
    },
  },
  defaultVariants: { gap: 2, align: 'center' },
});

/** Props for {@link Stack}. */
export interface StackProps
  extends React.HTMLAttributes<HTMLElement>, VariantProps<typeof stackVariants> {
  /** The element to render (default `div`); use to keep semantics (`section`, `ul`, …). */
  readonly as?: React.ElementType;
}

/** A vertical flex container with a tokenized `gap`. */
export function Stack({
  as: Component = 'div',
  gap,
  align,
  className,
  ...props
}: StackProps): React.JSX.Element {
  return <Component className={cn(stackVariants({ gap, align }), className)} {...props} />;
}

/** Props for {@link Row}. */
export interface RowProps
  extends React.HTMLAttributes<HTMLElement>, VariantProps<typeof rowVariants> {
  /** The element to render (default `div`); use to keep semantics (`header`, `nav`, …). */
  readonly as?: React.ElementType;
}

/** A horizontal flex container with a tokenized `gap`, centered by default. */
export function Row({
  as: Component = 'div',
  gap,
  align,
  justify,
  className,
  ...props
}: RowProps): React.JSX.Element {
  return <Component className={cn(rowVariants({ gap, align, justify }), className)} {...props} />;
}

/** Props for {@link Toolbar}. */
export interface ToolbarProps extends Omit<React.HTMLAttributes<HTMLElement>, 'children'> {
  /**
   * The view's own controls — tabs, a lens switcher, a title. Sits flush against the container's
   * leading padding edge.
   */
  readonly leading?: React.ReactNode;
  /**
   * Controls that act *on* the view — filter, display, sort, density, create. Sits flush against
   * the container's trailing padding edge.
   */
  readonly trailing?: React.ReactNode;
  /** The height step both groups adopt. Omit to inherit from an enclosing `ControlGroup`. */
  readonly controlSize?: ControlSize;
  /** The element to render (default `div`); use `header` or `nav` where the semantics fit. */
  readonly as?: React.ElementType;
}

/**
 * A view header: primary controls at the leading edge, view-modifying controls at the trailing
 * edge, and nothing bunched.
 *
 * @param props - See {@link ToolbarProps}.
 * @returns A full-width row with two {@link ControlGroup}s pushed to opposite edges.
 *
 * @remarks
 * The launch review measured the same defect on six routes: `/portfolio`'s title row left 536px of
 * empty trailing space, `/orgs/:orgId/cycles` left 457px, and on `/orgs/:orgId/projects` the view
 * switcher and the Filter/Display controls were all packed against the left edge with 134px of
 * dead space to their right. Every one of those rows was a bare `<div className="flex items-center
 * gap-2">`, which has exactly one behaviour: pile everything at the start.
 *
 * A toolbar has two ends. Making them two named props means a screen cannot express the bunched
 * layout by accident — there is nowhere to put a control except one edge or the other. Both groups
 * share one control size, so the tabs on the left and the Display button on the right are the same
 * height, which was the other half of the finding.
 *
 * @example
 * ```tsx
 * <Toolbar
 *   controlSize="md"
 *   leading={<Tabs items={lenses} />}
 *   trailing={
 *     <>
 *       <Chip icon={<Filter />} variant="filter">Add filter</Chip>
 *       <Button variant="ghost" iconOnly aria-label="Display"><TuneRounded /></Button>
 *     </>
 *   }
 * />
 * ```
 */
export function Toolbar({
  as: Component = 'div',
  leading,
  trailing,
  controlSize,
  className,
  ...props
}: ToolbarProps): React.JSX.Element {
  return (
    <Component
      className={cn('flex w-full min-w-0 items-center justify-between', className)}
      {...props}
    >
      <ControlGroup controlSize={controlSize} className="min-w-0">
        {leading}
      </ControlGroup>
      <ControlGroup controlSize={controlSize} className="shrink-0">
        {trailing}
      </ControlGroup>
    </Component>
  );
}
