import { ControlGroup, Stack, Text } from '@docket/ui/primitives';
import type { JSX, ReactNode } from 'react';

/**
 * How wide a screen's content column is allowed to grow, named by the job the width serves.
 *
 * @remarks
 * A closed set, because the console previously carried four different maximum widths and two
 * padding recipes across nine hand-rolled containers, so the content box visibly resized as an
 * operator moved between screens. Each value states what it is for rather than how big it is, which
 * is what stops the next screen from inventing a fifth.
 */
export type AdminPageWidth = 'form' | 'list' | 'console';

/** The measure each width resolves to. */
const WIDTH_CLASS: Readonly<Record<AdminPageWidth, string>> = {
  /** Forms, settings, and property detail — narrow enough to keep label/value pairs readable. */
  form: 'max-w-3xl',
  /** Lists and feeds, where rows want room but the eye still needs a line end. */
  list: 'max-w-5xl',
  /** Master–detail consoles that put a queue beside its detail pane. */
  console: 'max-w-7xl',
};

/** Props for {@link AdminPage}. */
export interface AdminPageProps {
  /** The width class this screen's content column takes. */
  readonly width: AdminPageWidth;
  /** The screen's content. */
  readonly children: ReactNode;
}

/**
 * The one content container every operator screen renders into.
 *
 * @remarks
 * Padding steps up at the panel's own `@2xl` container breakpoint rather than a viewport
 * breakpoint. `AppShell`'s `<main>` is a container-query context, and its width is the viewport
 * minus the sidebar, rail, and gutters — so a viewport breakpoint would give a narrow panel the
 * padding meant for a wide one.
 *
 * @param props - See {@link AdminPageProps}.
 * @returns the screen's content column.
 */
export function AdminPage({ width, children }: AdminPageProps): JSX.Element {
  return (
    <div className={`mx-auto flex w-full flex-col gap-6 p-4 @2xl:p-8 ${WIDTH_CLASS[width]}`}>
      {children}
    </div>
  );
}

/** Props for {@link AdminPageHeader}. */
export interface AdminPageHeaderProps {
  /** The screen's heading. */
  readonly title: string;
  /** An optional one-line description shown under the title. */
  readonly description?: string | undefined;
  /** Optional controls that act on the screen, grouped at the trailing edge. */
  readonly actions?: ReactNode;
}

/**
 * A screen heading with its controls.
 *
 * @remarks
 * The controls sit in a {@link ControlGroup} rather than a bare flex row, so a filter chip, a
 * search field, and a button on the same header all resolve to one height from one number instead
 * of each setting its own.
 *
 * @param props - See {@link AdminPageHeaderProps}.
 * @returns the screen header.
 */
export function AdminPageHeader({
  title,
  description,
  actions,
}: AdminPageHeaderProps): JSX.Element {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <Stack gap={1}>
        <Text as="h1" token="title-large">
          {title}
        </Text>
        {description ? (
          <Text as="p" token="body-medium" tone="muted">
            {description}
          </Text>
        ) : null}
      </Stack>
      {actions ? <ControlGroup controlSize="md">{actions}</ControlGroup> : null}
    </header>
  );
}

/** Props for {@link AdminSection}. */
export interface AdminSectionProps {
  /** The section heading. */
  readonly title: string;
  /** Optional supporting copy under the heading. */
  readonly description?: string | undefined;
  /** The section's content. */
  readonly children: ReactNode;
}

/**
 * A titled region within a screen.
 *
 * @remarks
 * Regions are separated by heading and rhythm, and where a region needs to read as contained it
 * takes a tonal step on the surface ramp. Neither case draws a line: the ramp is designed to
 * separate without one, which is what keeps the console from looking like a form wrapped in boxes.
 *
 * @param props - See {@link AdminSectionProps}.
 * @returns the titled section.
 */
export function AdminSection({ title, description, children }: AdminSectionProps): JSX.Element {
  return (
    <Stack gap={3} as="section">
      <Stack gap={1}>
        <Text as="h2" token="title-small">
          {title}
        </Text>
        {description ? (
          <Text as="p" token="body-small" tone="muted">
            {description}
          </Text>
        ) : null}
      </Stack>
      {children}
    </Stack>
  );
}
