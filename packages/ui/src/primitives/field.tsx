'use client';

/**
 * `@docket/ui` — the field family: one recipe behind every text input, textarea, select, search
 * box, and inline editor in the product.
 *
 * @remarks
 * ## The defect this replaces
 *
 * Before this module there was an `Input` primitive with no variant API at all
 * (`export type InputProps = React.ComponentProps<'input'>`, one hardcoded class string), and the
 * app routed around it: 36 raw `<input>`, 10 raw `<textarea>`, and 30 raw `<select>` elements in
 * `apps/web/src` alone, each inventing its own border, fill, height, and — in seven cases — its
 * own drop shadow. The primitive itself shipped `shadow-sm` in its default state, so even the
 * fields that *did* use it were elevated for no reason.
 *
 * ## The closed variant set
 *
 * Three variants. There is no fourth, and "shadowed" is not one of them.
 *
 * | Variant    | Border | Fill | Use for |
 * |------------|--------|------|---------|
 * | `outlined` | 1px `outline-variant` hairline | transparent | **default** — dialog and settings forms, anywhere a field sits on a plain panel and must announce itself as editable |
 * | `filled`   | none (transparent, box-size preserved) | `surface-container-high` | fields on an untinted surface where a hairline would be the loudest line on screen — search boxes, composers, toolbar filters |
 * | `plain`    | none | none | inline editors that must sit on the same axis as the text they replace — a row title you click to rename, a detail-page heading |
 *
 * Every variant renders a 1px border; `filled` and `plain` simply make it transparent. That is
 * deliberate: a `filled` field and an `outlined` field placed side by side are then the same box,
 * to the pixel, and swapping a field's variant never shifts its neighbours.
 *
 * ## What MD3 specifies, and where Docket differs
 *
 * From the Material Web token source (`tokens/_md-comp-outlined-text-field.scss`,
 * `tokens/versions/v0_192/_md-comp-outlined-text-field.scss`): `outline-width: 1px`,
 * `focus-outline-width: 2px`, `container-shape: corner-extra-small` (4dp), leading/trailing/top/
 * bottom space `16px`, leading and trailing icon `24px`, label and input text `body-large`.
 *
 * Docket applies the 1px resting outline and expresses MD3's 2px focus outline as the shared
 * {@link focusRing} (a `ring-2 ring-ring`) so a field's focus treatment is identical to a button's
 * — the alternative is two focus vocabularies in one form. Radius is 8px rather than 4px so a
 * field matches the chips and buttons beside it (see `control.tsx`), spacing comes from the
 * control-size scale rather than a fixed 16px so a field in a dense toolbar is not phone-sized,
 * and the icon size likewise steps with the control scale (18px at `md`, not 24px).
 *
 * ## Shadows
 *
 * Zero, in every state: default, hover, focus, filled, disabled, and error. The design-token
 * policy test fails the build if a `shadow-*` utility appears in this file or any field composed
 * from it. A focus ring is a ring, and it is named as one.
 *
 * @example
 * ```tsx
 * <Field label="Project name" description="Shown in the sidebar" error={error}>
 *   <Input value={name} onChange={…} />
 * </Field>
 *
 * <Input variant="filled" controlSize="sm" placeholder="Search projects" />
 * <Textarea variant="outlined" rows={4} />
 * <Select value={priority} onChange={…}>{…}</Select>
 * ```
 */
import * as React from 'react';

import { ChevronDown } from '../icons';
import { cn } from '../lib/utils';
import { CONTROL, CONTROL_RADIUS, type ControlSize, useControlSize } from './control';
import { focusRing } from './focus';
import { Text, typeClass } from './text';

/**
 * The complete, closed set of field treatments.
 *
 * @remarks
 * Exported so the design-system documentation and the primitive tests enumerate the same list the
 * implementation does. A fourth entry is a design-system change.
 */
export const FIELD_VARIANTS = ['outlined', 'filled', 'plain'] as const;

/** One of the three field treatments. See {@link FIELD_VARIANTS}. */
export type FieldVariant = (typeof FIELD_VARIANTS)[number];

/** Options accepted by {@link fieldSurface}. */
export interface FieldSurfaceOptions {
  /** The treatment. Default `outlined`. */
  readonly variant?: FieldVariant | undefined;
  /** The height step. Resolve it with `useControlSize` before calling. */
  readonly controlSize: ControlSize;
  /** Render the error treatment (also set `aria-invalid` on the element). */
  readonly invalid?: boolean | undefined;
  /**
   * Let the field grow with its content (`min-h-*` instead of `h-*`) and pad vertically.
   *
   * @remarks
   * Textareas only. A single-line field keeps a fixed height so it cannot disagree with the button
   * beside it.
   */
  readonly multiline?: boolean | undefined;
  /**
   * Which interaction triggers the focus ring. Default `'self'` rings the element this string is
   * applied to, correct for every ordinary field. Use `'within'` when this string is applied to a
   * wrapper whose focusable descendant is a different element — {@link Input}'s `prefix` is the
   * only caller today: the box is a `<span>`, so the ring has to key off the nested `<input>`
   * gaining focus instead.
   */
  readonly ringOn?: 'self' | 'within' | undefined;
}

/**
 * The one field recipe — every input, textarea, and select in the product is this string plus its
 * element.
 *
 * @param options - See {@link FieldSurfaceOptions}.
 * @returns The complete class string: box model, border, fill, type token, focus ring, and states.
 *
 * @remarks
 * Exported for the rare composed field that cannot use {@link Input}/{@link Textarea}/
 * {@link Select} directly — a contenteditable rich-text surface, or a third-party combobox that
 * owns its own DOM. Those callers must apply this string verbatim so they still land inside the
 * closed variant set rather than inventing a fourth look.
 */
export function fieldSurface({
  variant = 'outlined',
  controlSize,
  invalid = false,
  multiline = false,
  ringOn = 'self',
}: FieldSurfaceOptions): string {
  const metrics = CONTROL[controlSize];

  return cn(
    'placeholder:text-on-surface-variant w-full min-w-0 border transition-colors',
    ringOn === 'self'
      ? 'disabled:cursor-not-allowed disabled:opacity-50'
      : 'has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50',
    CONTROL_RADIUS,
    typeClass(metrics.fieldToken),
    multiline ? cn(metrics.minHeight, 'py-2') : metrics.height,
    variant === 'plain' ? 'px-0' : metrics.paddingX,
    variant === 'outlined' && 'border-outline-variant hover:border-outline bg-transparent',
    variant === 'filled' &&
      'bg-surface-container-high hover:bg-surface-container-highest border-transparent',
    variant === 'plain' && 'hover:bg-surface-container-high border-transparent bg-transparent',
    invalid && 'border-error',
    ringOn === 'self' ? focusRing : 'focus-within:ring-ring focus-within:ring-2',
  );
}

/** Props for {@link Input}. */
export interface InputProps extends Omit<React.ComponentProps<'input'>, 'size'> {
  /** The treatment. Default `outlined`. */
  readonly variant?: FieldVariant;
  /**
   * The height step. Omit to inherit from the enclosing `ControlGroup`.
   *
   * @remarks
   * Named `controlSize` rather than `size` across every primitive because `<input size>` and
   * `<select size>` are native HTML attributes with unrelated meaning. One name everywhere is
   * worth more than matching the CSS vocabulary on two elements.
   */
  readonly controlSize?: ControlSize;
  /**
   * Fixed text shown inline immediately before the editable value — e.g. the host a slug is
   * relative to. Renders in the same box, at the same type scale, as plain text distinguished
   * from the editable part only by a muted tone — never a separate chip or a second box. Omit for
   * a plain input.
   */
  readonly prefix?: string;
}

/**
 * Single-line text field.
 *
 * @param props - See {@link InputProps}, plus every native `<input>` prop except `size`.
 * @returns A token-styled `<input>` with no elevation in any state.
 */
export function Input({
  className,
  variant,
  controlSize,
  type,
  prefix,
  'aria-invalid': ariaInvalid,
  ...props
}: InputProps): React.JSX.Element {
  const size = useControlSize(controlSize);

  if (prefix === undefined) {
    return (
      <input
        type={type}
        aria-invalid={ariaInvalid}
        className={cn(
          fieldSurface({ variant, controlSize: size, invalid: ariaInvalid === true }),
          'file:text-on-surface file:border-0 file:bg-transparent',
          className,
        )}
        {...props}
      />
    );
  }

  const metrics = CONTROL[size];
  return (
    <span
      className={cn(
        fieldSurface({
          variant,
          controlSize: size,
          invalid: ariaInvalid === true,
          ringOn: 'within',
        }),
        'inline-flex items-center',
        className,
      )}
    >
      <span aria-hidden className="text-on-surface-variant shrink-0 truncate select-none">
        {prefix}
      </span>
      <input
        type={type}
        aria-invalid={ariaInvalid}
        className={cn(
          typeClass(metrics.fieldToken),
          'text-on-surface min-w-0 flex-1 border-0 bg-transparent p-0 outline-none',
          'placeholder:text-on-surface-variant file:text-on-surface file:border-0 file:bg-transparent',
        )}
        {...props}
      />
    </span>
  );
}

/** Props for {@link Textarea}. */
export interface TextareaProps extends React.ComponentProps<'textarea'> {
  /** The treatment. Default `outlined`. */
  readonly variant?: FieldVariant;
  /** The height step, which sets the *minimum* height. Omit to inherit from a `ControlGroup`. */
  readonly controlSize?: ControlSize;
}

/**
 * Multi-line text field.
 *
 * @param props - See {@link TextareaProps}, plus every native `<textarea>` prop.
 * @returns A token-styled `<textarea>` sharing the exact recipe {@link Input} uses.
 *
 * @remarks
 * Grows from the control step's height rather than a fixed row count, so an empty composer lines
 * up with the single-line fields around it and only diverges once there is content to justify it.
 */
export function Textarea({
  className,
  variant,
  controlSize,
  'aria-invalid': ariaInvalid,
  ...props
}: TextareaProps): React.JSX.Element {
  const size = useControlSize(controlSize);
  return (
    <textarea
      aria-invalid={ariaInvalid}
      className={cn(
        fieldSurface({
          variant,
          controlSize: size,
          invalid: ariaInvalid === true,
          multiline: true,
        }),
        className,
      )}
      {...props}
    />
  );
}

/** Props for {@link Select}. */
export interface SelectProps extends Omit<React.ComponentProps<'select'>, 'size'> {
  /** The treatment. Default `outlined`. */
  readonly variant?: FieldVariant;
  /** The height step. Omit to inherit from the enclosing `ControlGroup`. */
  readonly controlSize?: ControlSize;
}

/**
 * Native single-choice select.
 *
 * @param props - See {@link SelectProps}, plus every native `<select>` prop except `size`.
 * @returns A token-styled `<select>` with a chevron rendered as an overlaid icon.
 *
 * @remarks
 * The chevron is a real element rather than a `background-image` data URI: a background image
 * would hardcode a colour that cannot follow the light/dark theme, which is precisely the kind of
 * off-token value the launch audit flagged. `appearance-none` removes the platform arrow; the
 * trailing padding reserves the chevron's column so the value text never runs under it.
 *
 * Use this for short, flat, single-choice lists. Anything that needs search, icons per option, or
 * grouping is a `DropdownMenu`, not a select.
 */
export function Select({
  className,
  variant,
  controlSize,
  children,
  'aria-invalid': ariaInvalid,
  ...props
}: SelectProps): React.JSX.Element {
  const size = useControlSize(controlSize);
  const metrics = CONTROL[size];
  return (
    <span className="relative inline-flex w-full items-center">
      <select
        aria-invalid={ariaInvalid}
        className={cn(
          fieldSurface({ variant, controlSize: size, invalid: ariaInvalid === true }),
          'appearance-none',
          // Reserve the chevron column: its own width plus the step's gap on each side.
          'pr-8',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className={cn(
          'text-on-surface-variant pointer-events-none absolute top-1/2 right-2 -translate-y-1/2',
          metrics.icon,
        )}
      />
    </span>
  );
}

/** Props for {@link Field}. */
export interface FieldProps extends Omit<React.ComponentProps<'div'>, 'title'> {
  /** The field's visible label. */
  readonly label: React.ReactNode;
  /** Optional helper copy shown beneath the control when there is no error. */
  readonly description?: React.ReactNode;
  /**
   * Application-owned error copy.
   *
   * @remarks
   * Must be a string this application wrote. Never pass an exception message, a provider's
   * `error_description`, or a Problem `detail` — the source-policy test enforces that separately,
   * and this prop is the most tempting place to violate it.
   */
  readonly error?: string;
  /** The control. Exactly one {@link Input}, {@link Textarea}, or {@link Select}. */
  readonly children: React.ReactNode;
}

/**
 * Label + control + supporting-text wrapper.
 *
 * @param props - See {@link FieldProps}.
 * @returns A labelled field group with consistent vertical rhythm.
 *
 * @remarks
 * Exists so labels are as standardised as the controls under them. Every settings and dialog form
 * that renders its own `<label className="text-sm font-medium">` is re-deriving this, and each
 * one lands on a slightly different size — which is how a form ends up with four label styles.
 * The label is `label-large`; supporting text is `body-small`; the gap is fixed.
 */
export function Field({
  label,
  description,
  error,
  children,
  className,
  ...props
}: FieldProps): React.JSX.Element {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)} {...props}>
      {/*
       * `display: contents` keeps the label element in the DOM — so the control is *implicitly*
       * associated with it and needs no generated id — while leaving the outer flex column in
       * charge of spacing. An explicit `htmlFor` would require cloning the child to inject an id,
       * which breaks the moment a caller wraps their control in anything.
       */}
      <label className="contents">
        <Text as="span" token="label-large">
          {label}
        </Text>
        {children}
      </label>
      {error === undefined ? (
        description === undefined ? null : (
          <Text token="body-small" tone="muted">
            {description}
          </Text>
        )
      ) : (
        <Text token="body-small" tone="error" role="alert">
          {error}
        </Text>
      )}
    </div>
  );
}
