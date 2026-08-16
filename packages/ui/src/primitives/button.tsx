'use client';

/**
 * `@docket/ui` — Button primitive.
 *
 * @remarks
 * Height, horizontal padding, gap, radius, label type token, and icon size all come from the
 * shared control-size scale in `./control`, so a button and the chip, select, or menu trigger
 * beside it are the same height without anyone choosing a number. Only the *colour* treatment is
 * the button's own decision, and that is the `variant` axis.
 *
 * ## Variants (MD3 button styles)
 *
 * | Variant       | MD3 name      | Use for |
 * |---------------|---------------|---------|
 * | `default`     | Filled        | the one primary action on a surface |
 * | `secondary`   | Filled tonal  | a secondary action that still needs weight |
 * | `outline`     | Outlined      | a secondary action on a busy surface |
 * | `ghost`       | Text          | tertiary actions, toolbar and row affordances |
 * | `link`        | Text (inline) | navigation rendered inside prose |
 * | `destructive` | Filled, error | the confirm action of a destructive flow |
 *
 * MD3's **Elevated** button — the one MD3 button style that carries a shadow (`level1`) — is
 * deliberately not offered. It existed here as a `shadow-sm`/`hover:shadow` variant, had zero
 * callsites in the entire monorepo, and the only thing it could do was reintroduce the drop
 * shadows the rest of this file removed.
 *
 * ## No size-changing interaction states
 *
 * Nothing in this recipe scales, grows, or re-pads on hover, focus, or press. Feedback is the
 * colour state layer plus the shared focus ring; the box is fixed. The design-token policy test
 * fails the build on any `hover:scale-*` / `active:scale-*` / `hover:p-*` in production source, so
 * this is enforced rather than remembered.
 */
import { Slot } from '@radix-ui/react-slot';
import * as React from 'react';

import { cn } from '../lib/utils';
import { controlChrome, type ControlSize, useControlSize } from './control';
import { focusRing } from './focus';

/** The colour treatments a button may take. */
export const BUTTON_VARIANTS = [
  'default',
  'secondary',
  'outline',
  'ghost',
  'link',
  'destructive',
  'ghost-destructive',
] as const;

/** One of the button colour treatments. See {@link BUTTON_VARIANTS}. */
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number];

const BUTTON_COLOR: Readonly<Record<ButtonVariant, string>> = {
  default: 'bg-primary text-on-primary hover:bg-primary/90',
  // MD3's filled tonal button: a container role rather than the `secondary` accent.
  secondary: 'bg-secondary-container text-on-secondary-container hover:bg-secondary-container/80',
  outline:
    'border-outline-variant hover:bg-surface-container-high hover:text-on-surface border bg-transparent',
  ghost: 'hover:bg-surface-container-high hover:text-on-surface',
  link: 'text-primary underline-offset-4 hover:underline',
  destructive: 'bg-error text-on-error hover:bg-error/90',
  // The *trigger* for a destructive action, as distinct from the confirm step `destructive` paints.
  // A filled error button on a row that merely opens a confirmation overstates what the click does
  // and turns a list of five rows into five red blocks. Repeating `focus:` is not redundant: a
  // menu item resets its colour on focus, so a `text-error` alone silently loses its tone the
  // moment you arrive by keyboard — which is how eighteen hand-rolled copies of this ended up
  // split between ones that remembered and ones that did not.
  'ghost-destructive': 'text-error hover:text-error focus:text-error hover:bg-error/10',
};

/**
 * The button's pre-scale size vocabulary, retained so existing callsites keep their exact pixel
 * height while screens migrate to `controlSize`.
 *
 * @remarks
 * This is a **name mapping onto the control scale**, not a second scale — each value resolves to
 * one of the five steps and the geometry still comes from a single place. `icon` additionally
 * implies the square, label-less shape, which is why the new API splits that concern out into the
 * independent `iconOnly` prop: under the old vocabulary "a small icon button" was unexpressible,
 * because shape and height shared one axis.
 *
 * Delete this axis (and {@link LEGACY_BUTTON_SIZE}) once no callsite passes `size`.
 */
export type LegacyButtonSize = 'default' | 'sm' | 'lg' | 'icon';

/** Legacy size name → control step. Chosen so every existing callsite renders unchanged. */
const LEGACY_BUTTON_SIZE: Readonly<Record<LegacyButtonSize, ControlSize>> = {
  default: 'lg',
  sm: 'md',
  lg: 'xl',
  icon: 'xl',
};

/** Options accepted by {@link buttonVariants}. */
export interface ButtonVariantsOptions {
  /** The colour treatment. Default `default`. */
  readonly variant?: ButtonVariant | null;
  /** Legacy size name. See {@link LegacyButtonSize}. */
  readonly size?: LegacyButtonSize | null;
  /** The control step, when the caller already speaks the new vocabulary. */
  readonly controlSize?: ControlSize;
  /** Extra classes appended last. */
  readonly className?: string;
}

/**
 * Build a button's complete class string without rendering a {@link Button}.
 *
 * @param options - See {@link ButtonVariantsOptions}.
 * @returns Geometry from the control scale plus the variant's colour role.
 *
 * @remarks
 * For elements that must look like a button but cannot be one — a router `Link`, an anchor
 * rendered by a third-party component. Prefer `<Button asChild>` when the child is under your
 * control, because `asChild` also carries the disabled and focus behaviour.
 */
export function buttonVariants(options?: ButtonVariantsOptions): string {
  const variant = options?.variant ?? 'default';
  const legacy = options?.size ?? null;
  const step: ControlSize =
    options?.controlSize ?? (legacy === null ? 'md' : LEGACY_BUTTON_SIZE[legacy]);
  return cn(
    controlChrome(step, { iconOnly: legacy === 'icon' }),
    BUTTON_COLOR[variant],
    focusRing,
    options?.className,
  );
}

/** Props for {@link Button}. */
export interface ButtonProps extends Omit<React.ComponentProps<'button'>, 'color'> {
  /** The colour treatment. Default `default`. */
  readonly variant?: ButtonVariant | null | undefined;
  /** Legacy size name. Prefer {@link ButtonProps.controlSize}. See {@link LegacyButtonSize}. */
  readonly size?: LegacyButtonSize | null | undefined;
  /**
   * The height step. Omit to inherit from the enclosing `ControlGroup`, which is how a button ends
   * up the same height as the chips and selects beside it without anyone measuring.
   */
  readonly controlSize?: ControlSize | undefined;
  /** Render a square, label-less button sized to the resolved control step. */
  readonly iconOnly?: boolean | undefined;
  /** When `true`, render styling onto the single child element via Radix `Slot`. */
  readonly asChild?: boolean | undefined;
}

/**
 * Themeable button.
 *
 * @param props - See {@link ButtonProps}.
 * @returns A `<button>`, or the child element when `asChild` is set.
 *
 * @example
 * ```tsx
 * <Button onClick={save}>Save</Button>
 * <Button variant="ghost" iconOnly aria-label="More actions"><Ellipsis /></Button>
 * <Button asChild variant="link"><Link href="/settings">Settings</Link></Button>
 * ```
 */
export function Button({
  className,
  variant,
  size,
  controlSize,
  iconOnly = false,
  asChild = false,
  ...props
}: ButtonProps): React.JSX.Element {
  // An explicit legacy `size` wins over the ambient group so a migrated toolbar cannot silently
  // resize a button that still names its own height.
  const explicit = controlSize ?? (size ? LEGACY_BUTTON_SIZE[size] : undefined);
  const step = useControlSize(explicit);
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      className={cn(
        controlChrome(step, { iconOnly: iconOnly || size === 'icon' }),
        BUTTON_COLOR[variant ?? 'default'],
        focusRing,
        className,
      )}
      {...props}
    />
  );
}
