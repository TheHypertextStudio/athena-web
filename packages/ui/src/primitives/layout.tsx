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
