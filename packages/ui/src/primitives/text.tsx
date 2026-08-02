/**
 * `@docket/ui` — the type scale: the closed set of MD3 type roles and the {@link Text} primitive
 * that is the only supported way to set them.
 *
 * @remarks
 * ## Why a primitive and not a convention
 *
 * A scan of the app at the launch review found 819 raw type utilities — 415 `text-xs`, 240
 * `text-sm`, plus `text-[10px]`, `text-[11px]`, `text-[3rem]`, `tracking-[-0.015em]`,
 * `leading-[1.1]` — none of which correspond to a design decision anyone made twice. Tailwind's
 * `text-xs`/`text-sm` are a *different* type scale that happens to be installed alongside ours,
 * and every use of one is a silent fork of the design system.
 *
 * The 15 MD3 roles below are the whole vocabulary. They are defined once, in
 * `styles/globals.css`, as Tailwind v4 `--text-*` theme tokens that carry size **and**
 * line-height **and** weight **and** letter-spacing together — so selecting a role selects all
 * four, and there is nothing left to tune at the callsite. That is why {@link Text} has no
 * `weight`, `size`, `leading`, or `tracking` prop and never will: if a label needs to be heavier
 * than `body-medium`, the answer is `label-large` or `title-small`, not `font-semibold`.
 *
 * ## The roles
 *
 * | Family     | Role             | Size / line-height | Weight | Use for |
 * |------------|------------------|--------------------|--------|---------|
 * | `display`  | `display-large`  | 57 / 64            | 400    | the single hero number or word on a marketing or empty-state surface |
 * |            | `display-medium` | 45 / 52            | 400    | " |
 * |            | `display-small`  | 36 / 44            | 400    | " |
 * | `headline` | `headline-large` | 32 / 40            | 400    | a page's own name, when the page is a document |
 * |            | `headline-medium`| 28 / 36            | 400    | " |
 * |            | `headline-small` | 24 / 32            | 400    | dialog titles, entity detail titles |
 * | `title`    | `title-large`    | 22 / 28            | 400    | section headings inside a page |
 * |            | `title-medium`   | 16 / 24            | 500    | card + panel headings, list-group headers |
 * |            | `title-small`    | 14 / 20            | 500    | dense section headings, table column groups |
 * | `body`     | `body-large`     | 16 / 24            | 400    | long-form reading copy (descriptions, comments) |
 * |            | `body-medium`    | 14 / 20            | 400    | **the app's default text** — row titles, field values, paragraphs |
 * |            | `body-small`     | 12 / 16            | 400    | secondary metadata under a row title |
 * | `label`    | `label-large`    | 14 / 20            | 500    | control labels: buttons, chips, tabs, menu rows |
 * |            | `label-medium`   | 12 / 16            | 500    | dense control labels, table column headers |
 * |            | `label-small`    | 11 / 16            | 500    | counts, badges, timestamps, keyboard hints |
 *
 * ## Choosing between `body-small` and `label-small`
 *
 * `body-*` is prose the user reads; `label-*` is a name for something the user acts on or scans.
 * A row's supporting sentence is `body-small`; the "3" in a count badge and the "⌘K" hint are
 * `label-small`. Getting this wrong is not a rendering bug, but it is the difference between a
 * screen that reads as designed and one that reads as assembled.
 *
 * @example
 * ```tsx
 * <Text as="h2" token="title-medium">Active projects</Text>
 * <Text token="body-small" tone="muted">Updated 3 hours ago</Text>
 * <Text token="label-small" tone="muted" numeric>{count}</Text>
 * ```
 */
import * as React from 'react';

import { cn } from '../lib/utils';

/**
 * Every type role the design system defines, in MD3's canonical order.
 *
 * @remarks
 * This array is the enforcement surface: the design-token policy test reads it to build the set of
 * legal `text-*` utilities, so adding a role here (and its `--text-*` token in `globals.css`) is
 * the *only* way to make a new type size legal anywhere in the product.
 */
export const TYPE_TOKENS = [
  'display-large',
  'display-medium',
  'display-small',
  'headline-large',
  'headline-medium',
  'headline-small',
  'title-large',
  'title-medium',
  'title-small',
  'body-large',
  'body-medium',
  'body-small',
  'label-large',
  'label-medium',
  'label-small',
] as const;

/** One of the 15 MD3 type roles. See {@link TYPE_TOKENS}. */
export type TypeToken = (typeof TYPE_TOKENS)[number];

/**
 * Map from a type role to its Tailwind utility.
 *
 * @remarks
 * Written as 15 literals rather than derived with a template literal, because Tailwind v4
 * extracts class names by scanning source text: a computed `` `text-${token}` `` would never be
 * generated. Any helper in this package that needs a type class must go through
 * {@link typeClass}, never through string interpolation.
 */
const TYPE_CLASS: Readonly<Record<TypeToken, string>> = {
  'display-large': 'text-display-large',
  'display-medium': 'text-display-medium',
  'display-small': 'text-display-small',
  'headline-large': 'text-headline-large',
  'headline-medium': 'text-headline-medium',
  'headline-small': 'text-headline-small',
  'title-large': 'text-title-large',
  'title-medium': 'text-title-medium',
  'title-small': 'text-title-small',
  'body-large': 'text-body-large',
  'body-medium': 'text-body-medium',
  'body-small': 'text-body-small',
  'label-large': 'text-label-large',
  'label-medium': 'text-label-medium',
  'label-small': 'text-label-small',
};

/**
 * Resolve a type role to its Tailwind utility class.
 *
 * @param token - The MD3 type role.
 * @returns The single utility that sets size, line-height, weight, and tracking together.
 *
 * @example
 * ```ts
 * cn('truncate', typeClass('body-medium'));
 * ```
 */
export function typeClass(token: TypeToken): string {
  return TYPE_CLASS[token];
}

/**
 * The closed set of text colour roles.
 *
 * @remarks
 * Deliberately short. `default` and `muted` cover almost everything; the rest exist because a
 * specific semantic exists, not because a designer wanted a shade. `inherit` is for text inside a
 * container that already set a colour role (a selected menu row, a filled chip) — it is how you
 * avoid fighting the parent rather than an excuse to skip the decision.
 */
export const TEXT_TONES = ['default', 'muted', 'accent', 'error', 'inverse', 'inherit'] as const;

/** One of the text colour roles. See {@link TEXT_TONES}. */
export type TextTone = (typeof TEXT_TONES)[number];

const TONE_CLASS: Readonly<Record<TextTone, string>> = {
  default: 'text-on-surface',
  muted: 'text-on-surface-variant',
  accent: 'text-primary',
  error: 'text-error',
  inverse: 'text-inverse-on-surface',
  inherit: '',
};

/**
 * Resolve a text tone to its Tailwind colour utility.
 *
 * @param tone - The colour role.
 * @returns The colour utility, or an empty string for `inherit`.
 */
export function toneClass(tone: TextTone): string {
  return TONE_CLASS[tone];
}

/** Props for {@link Text}. */
export interface TextProps extends React.HTMLAttributes<HTMLElement> {
  /**
   * The element to render. Default `span`.
   *
   * @remarks
   * Type role and heading level are independent on purpose: a visually small section heading is
   * `<Text as="h3" token="label-medium">`, which keeps the document outline correct without
   * bending the type scale to match it.
   */
  readonly as?: React.ElementType;
  /** The MD3 type role. Required — there is no default, because "whatever" is not a size. */
  readonly token: TypeToken;
  /** The colour role. Default `default`. */
  readonly tone?: TextTone;
  /** Clamp to one line with an ellipsis. */
  readonly truncate?: boolean;
  /**
   * Render digits at a fixed width (`tabular-nums`).
   *
   * @remarks
   * Use on any number that changes in place — counters, durations, time estimates, table columns —
   * so the text does not jitter as the value updates. This is a typographic feature of the role,
   * not a new size, which is why it lives here rather than as a raw utility at the callsite.
   */
  readonly numeric?: boolean;
}

/**
 * Render text at a named MD3 type role.
 *
 * @remarks
 * The only supported way to set type in this product. Passing `className` is allowed for layout
 * concerns (margins, `flex-1`, `min-w-0`); passing a font-size, weight, line-height, or tracking
 * utility through `className` is a design-token policy violation and fails the build.
 *
 * @param props - See {@link TextProps}.
 * @returns The element, carrying exactly one type utility and one colour utility.
 */
export function Text({
  as: Component = 'span',
  token,
  tone = 'default',
  truncate = false,
  numeric = false,
  className,
  ...props
}: TextProps): React.JSX.Element {
  return (
    <Component
      className={cn(
        typeClass(token),
        toneClass(tone),
        truncate && 'block truncate',
        numeric && 'tabular-nums',
        className,
      )}
      {...props}
    />
  );
}
