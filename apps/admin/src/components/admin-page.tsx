import { ControlGroup, Row, Stack, Surface, Text } from '@docket/ui/primitives';
import type { JSX, ReactNode } from 'react';

import { AdminOutline, CONTENT_ID, SECTION_ATTRIBUTE, sectionId } from './admin-outline';

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
  /**
   * Whether to show the section outline beside the content.
   *
   * @remarks
   * Set it on screens that run past a viewport. The rail reads the sections a screen actually
   * rendered, so turning it on costs nothing on a screen that turns out to be short — it hides
   * itself below two sections.
   */
  readonly outline?: boolean;
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
export function AdminPage({ width, outline = false, children }: AdminPageProps): JSX.Element {
  const column = (
    <div id={CONTENT_ID} className="flex min-w-0 flex-col gap-4">
      {children}
    </div>
  );

  if (!outline) {
    return (
      <div className={`mx-auto flex w-full flex-col p-4 @2xl:p-8 ${WIDTH_CLASS[width]}`}>
        {column}
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-8 p-4 @2xl:p-8 @4xl:grid-cols-[minmax(0,1fr)_12rem]">
      {column}
      <AdminOutline />
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
    <Row as="header" align="end" justify="between" gap={4} className="flex-wrap">
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
    </Row>
  );
}

/** Props for {@link AdminSection}. */
export interface AdminSectionProps {
  /** The section heading. */
  readonly title: string;
  /** Optional supporting copy under the heading. */
  readonly description?: string | undefined;
  /** Optional controls acting on this group, pinned to the header's trailing edge. */
  readonly action?: ReactNode;
  /**
   * How the body is inset.
   *
   * @remarks
   * `padded` is the default and suits properties, prose, and forms. `rows` removes the inset for
   * content that manages its own — a table, a row list — so those reach the group's edges instead
   * of sitting in a second, narrower box.
   */
  readonly body?: 'padded' | 'rows';
  /** The section's content. */
  readonly children: ReactNode;
}

/**
 * A named tonal group: one card step above the page panel, with no border and no shadow.
 *
 * @remarks
 * This is the console's unit of grouping, and it mirrors the product app's `SettingsGroup`
 * deliberately — same `card` tone, same `medium` shape, same header rhythm — so a group here and a
 * group there read as the same thing.
 *
 * It previously rendered a heading above naked children, which is half of what §8 asks for. Dropping
 * the borders was right; nothing replaced them, so a detail screen became an undifferentiated run of
 * headings and text with no visible region boundaries at all. A tonal step is what the surface ramp
 * exists for, and it is what does the grouping now.
 *
 * A padded body wraps its children in a `lg` {@link ControlGroup}, so an input, a select, and the
 * button beside them resolve to one height from one number rather than each falling back to the
 * bare default — which is why the billing actions used to render at mixed heights.
 *
 * The group is its own `@container`, so its contents reflow against the group's width rather than
 * the page's — a property list inside a narrow master–detail column wraps on its own terms.
 *
 * @param props - See {@link AdminSectionProps}.
 * @returns the titled group.
 */
export function AdminSection({
  title,
  description,
  action,
  body = 'padded',
  children,
}: AdminSectionProps): JSX.Element {
  return (
    <Surface
      as="section"
      id={sectionId(title)}
      {...{ [SECTION_ATTRIBUTE]: title }}
      tone="card"
      shape="medium"
      pad="none"
      className="@container flex scroll-mt-4 flex-col overflow-hidden"
    >
      <div className="flex flex-col gap-3 px-4 pt-4 pb-3 @lg:flex-row @lg:items-start @lg:justify-between">
        <Stack gap={1} className="min-w-0">
          <Text as="h2" token="title-small">
            {title}
          </Text>
          {description ? (
            <Text as="p" token="body-small" tone="muted">
              {description}
            </Text>
          ) : null}
        </Stack>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>

      {body === 'rows' ? (
        <div className="flex min-w-0 flex-col px-4 pb-4">{children}</div>
      ) : (
        <ControlGroup controlSize="lg" orientation="vertical" className="min-w-0 gap-3 px-4 pb-4">
          {children}
        </ControlGroup>
      )}
    </Surface>
  );
}
