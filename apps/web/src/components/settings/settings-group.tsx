/**
 * `settings` — the tonal group container every Settings surface builds from.
 *
 * @remarks
 * This is the answer to the audit's largest single finding: **70 distinct card signatures across
 * 108 sites**, 47 of them appearing exactly once. Settings had four radii, four card paddings and
 * three mutually exclusive card treatments (outlined-no-fill, filled-no-border, and both at once)
 * for what is visually one object, because no component named that object and every screen
 * re-derived it.
 *
 * ## Why there is no border
 *
 * `docs/design/design-system.md` §8 separates two regions with a step on the tonal ramp rather than
 * a line, and reserves borders for a field's editable affordance, a focus indicator, or a genuine
 * semantic boundary. Settings carried 88 `border-outline-variant` hairlines anyway — because its
 * ramp ran backwards. The settings modal's panel is `surface-container-high`, and the cards drawn
 * on it were `surface-container-low`: *below* their own background, hence invisible, hence outlined
 * to bring the edges back. With the content pane lowered to `surface` (`SettingsPane`), a `card`
 * step is one tone **above** the pane and separates itself, so the lines are simply removed rather
 * than restyled.
 *
 * ## Rows are flush, content is inset
 *
 * A group of rows wants its hover and selection states to reach the container's edges, and a group
 * holding a form wants breathing room. Those are different boxes, so `body` names which one you
 * are building instead of leaving each call site to add or omit padding by eye — the specific way
 * the old `p-3`/`p-4`/`p-5`/`p-6` split arose.
 */
import { cn } from '@docket/ui';
import { SETTINGS_GROUP_ATTR, settingsGroupId } from './settings-outline';
import { ControlGroup, Surface, Text } from '@docket/ui/primitives';
import type * as React from 'react';
import type { JSX, ReactNode } from 'react';
import type { SettingsNodeDefinition } from './settings-capabilities';

/** Props for {@link SettingsGroup}. */
export interface SettingsGroupProps extends Omit<
  React.ComponentPropsWithoutRef<'section'>,
  'title' | 'className' | 'children'
> {
  /** The group's heading. Omit for an unheaded container (a bare run of rows). */
  readonly title?: string;
  /** Stable searchable definition for a static Settings heading. */
  readonly capability?: SettingsNodeDefinition;
  /** Marks a data-derived heading that must not enter the application capability catalog. */
  readonly discoverable?: false;
  /** A glyph before the heading. Decorative — the heading is what names the group. */
  readonly icon?: ReactNode;
  /** A short, plain-language line under the heading. */
  readonly description?: ReactNode;
  /** A control aligned to the heading's trailing edge (e.g. "Add passkey"). */
  readonly action?: ReactNode;
  /**
   * How the body is boxed.
   *
   * `padded` (the default) insets the content and stacks it with a consistent gap — for forms,
   * prose, and a group holding one control. `rows` removes the inset so {@link SettingRow}s span
   * the full width and their hover state reaches the container's edges.
   */
  readonly body?: 'padded' | 'rows';
  /**
   * A full-bleed band pinned beneath the body, for a persistent note or alert — pass a
   * {@link CardNote} or {@link CardAlert}, which paint the band's own tonal step.
   */
  readonly footer?: ReactNode;
  /** The group's content. */
  readonly children?: ReactNode;
  /** Extra classes merged onto the container (layout only — never colour, radius, or padding). */
  readonly className?: string;
}

/**
 * A named tonal group: one card step above the settings content pane, with no border and no shadow.
 *
 * @param props - The {@link SettingsGroupProps}.
 * @returns the rendered group.
 */
export function SettingsGroup({
  title,
  capability,
  icon,
  description,
  action,
  body = 'padded',
  footer,
  children,
  className,
  ...rest
}: SettingsGroupProps): JSX.Element {
  const resolvedTitle = capability?.label ?? title;
  const resolvedDescription = capability?.description ?? description;
  const headingId = capability
    ? `settings-${capability.id}`
    : resolvedTitle
      ? settingsGroupId(resolvedTitle)
      : undefined;
  const hasHeader = Boolean(resolvedTitle ?? resolvedDescription ?? action);
  return (
    <Surface
      as="section"
      tone="card"
      shape="medium"
      pad="none"
      // Its own container, so a group's header answers to the group's width rather than the
      // page's — a group inside a narrow column reflows on its own terms.
      className={cn('@container flex flex-col overflow-hidden', className)}
      // Deliberately unnamed. The `<h3>` already places the group in the document outline, and
      // naming the section too would make it a region landmark — one per card, on a surface built
      // entirely of cards, which is landmark spam. It also made the group answer to a name already
      // on screen, so the "Quiet hours" checkbox inside the "Quiet hours" group became ambiguous
      // to anything resolving that name. A caller that genuinely needs a landmark can pass its own
      // `aria-label` through `rest`.
      {...rest}
    >
      {hasHeader ? (
        <div
          className={cn(
            'flex flex-col gap-3 px-4 pt-4 @lg:flex-row @lg:items-start @lg:justify-between',
            children ? 'pb-3' : 'pb-4',
          )}
        >
          <div className="flex min-w-0 flex-col gap-1">
            {resolvedTitle ? (
              // The id and the marker are what let the rail list this section's groups without a
              // second, hand-maintained copy of their names. See `settings-outline.tsx`.
              <Text
                as="h3"
                token="title-small"
                id={headingId}
                tabIndex={capability ? -1 : undefined}
                {...{ [SETTINGS_GROUP_ATTR]: '' }}
                className="flex items-center gap-2"
              >
                {icon ? (
                  <span className="text-on-surface-variant flex shrink-0 items-center">{icon}</span>
                ) : null}
                {resolvedTitle}
              </Text>
            ) : null}
            {resolvedDescription ? (
              <Text as="p" token="body-small" tone="muted">
                {resolvedDescription}
              </Text>
            ) : null}
          </div>
          {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
        </div>
      ) : null}

      {children ? (
        body === 'rows' ? (
          <div className="flex min-w-0 flex-col">{children}</div>
        ) : (
          // A padded group is a form, and `control.tsx` names `lg` (36px) as the settings-form
          // step. Every field in settings was rendering at the bare `md` default instead, because
          // a field with no `controlSize` and no group to inherit from falls back to it — 38 of
          // them, including two that then re-imposed `h-8` by hand. Declaring the step once here
          // is what makes an Input, a Select and the Button beside them agree without any of them
          // naming a height. `className` merges last, so the group keeps its own gap and inset.
          <ControlGroup
            controlSize="lg"
            orientation="vertical"
            className={cn('min-w-0 gap-3 px-4 pb-4', !hasHeader && 'pt-4')}
          >
            {children}
          </ControlGroup>
        )
      ) : null}

      {footer}
    </Surface>
  );
}
