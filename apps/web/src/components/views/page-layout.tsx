/**
 * `views` — the shared page shell every list/detail surface composes for its outer container and
 * its title block.
 *
 * @remarks
 * Before this, every index page hand-rolled its own `<main>` wrapper and `<header><h1>` markup, so
 * the page width, vertical rhythm, and — most visibly — the *title size* drifted between surfaces
 * (Projects/Initiatives on `text-headline-medium`, Programs and a dozen others on a different
 * token). These are **slot components**: {@link PageHeader} owns the header layout, {@link PageTitle}
 * owns the one canonical title token, and callers compose whatever they need between them (a plain
 * string, an inline-edit form, a badge row, a right-aligned action). Centralizing the token — not
 * the content — is what keeps titles from diverging while leaving each page free to compose. The
 * tokens mirror the Projects/Initiatives treatment, the direction the whole app is moving toward.
 */
import { cn } from '@docket/ui';
import type { JSX, ReactNode } from 'react';

/** Props for {@link PageContainer}. */
export interface PageContainerProps {
  /** The page body. */
  children: ReactNode;
  /** Extra classes merged after the shared container rhythm (e.g. a print scope). */
  className?: string;
  /** The landmark element to render — `main` for a route's primary content (the default). */
  as?: 'main' | 'div';
}

/**
 * The shared page container: centered, max-width, and the app's standard padding/gap rhythm.
 *
 * @remarks
 * Establishes the `max-w-7xl` measure and the `p-4 @2xl:p-6 @4xl:p-8` container-query padding used
 * across list pages, so no page re-declares it. The container queries assume an ancestor sets a
 * `@container` context (the `(app)` route-group layout does).
 */
export function PageContainer({
  children,
  className,
  as = 'main',
}: PageContainerProps): JSX.Element {
  const Element = as;
  return (
    <Element
      className={cn(
        // Vertical padding is deliberately tighter than horizontal so the page content starts near
        // the top instead of floating in dead space.
        'mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-4 @2xl:px-6 @2xl:py-5 @4xl:px-8 @4xl:py-6',
        className,
      )}
    >
      {children}
    </Element>
  );
}

/** Props for the header slot components. */
export interface SlotProps {
  /** Slot content. */
  children: ReactNode;
  /** Optional classes merged after the slot's own. */
  className?: string;
}

/**
 * The shared page masthead layout: a heading group on the left, actions on the right.
 *
 * @remarks
 * Pure layout — it arranges its children with `justify-between`. Compose a {@link PageHeading}
 * (title + optional subtitle) as the first child and any action (e.g. a "New …" button) as the
 * second. Nothing about the *content* is fixed here, only the arrangement.
 */
export function PageHeader({ children, className }: SlotProps): JSX.Element {
  return (
    <header className={cn('flex items-end justify-between gap-4', className)}>{children}</header>
  );
}

/** The left-hand heading group (title + optional subtitle), stacked. */
export function PageHeading({ children, className }: SlotProps): JSX.Element {
  return <div className={cn('flex min-w-0 flex-col gap-1', className)}>{children}</div>;
}

/**
 * The page title — the single `<h1>` for a surface, at the canonical size.
 *
 * @remarks
 * This component owns the title token (`text-headline-medium font-medium`); that is the entire
 * point of routing titles through it. `children` is free-form, so an inline-editable title can
 * render its own form inside without losing the shared type scale.
 */
export function PageTitle({ children, className }: SlotProps): JSX.Element {
  return (
    <h1 className={cn('text-on-surface text-headline-medium font-medium', className)}>
      {children}
    </h1>
  );
}

/** The one-line description under a {@link PageTitle}. */
export function PageSubtitle({ children, className }: SlotProps): JSX.Element {
  return <p className={cn('text-on-surface-variant mt-1 text-sm', className)}>{children}</p>;
}

/** Props for {@link ListPageLayout}. */
export interface ListPageLayoutProps {
  /** The title content, rendered inside the canonical {@link PageTitle}. */
  title: ReactNode;
  /** An optional one-line description under the title. */
  subtitle?: ReactNode;
  /** Optional right-aligned header action(s), typically the primary "New …" button. */
  actions?: ReactNode;
  /** An optional band between the header and the body — e.g. a filter toolbar or lens switcher. */
  toolbar?: ReactNode;
  /** The page body: the list itself plus its loading / empty / error states. */
  children: ReactNode;
}

/**
 * The standard list-page arrangement: container → header (title + subtitle + actions) → toolbar →
 * body, with the shared measure and rhythm.
 *
 * @remarks
 * This is the layer that owns the *arrangement* every index page repeated by hand. A page supplies
 * only its content through the slots — its vocabulary title, its primary action, its toolbar, its
 * rows — and never restates how those regions stack or space. Every slot is a node, so composition
 * stays free (a title can carry a badge, actions can be a cluster); the skeleton does not.
 */
export function ListPageLayout({
  title,
  subtitle,
  actions,
  toolbar,
  children,
}: ListPageLayoutProps): JSX.Element {
  return (
    <PageContainer>
      <PageHeader>
        <PageHeading>
          <PageTitle>{title}</PageTitle>
          {subtitle ? <PageSubtitle>{subtitle}</PageSubtitle> : null}
        </PageHeading>
        {actions}
      </PageHeader>
      {toolbar}
      {children}
    </PageContainer>
  );
}

/** Props for {@link DetailPageLayout}. */
export interface DetailPageLayoutProps {
  /** The masthead, composed by the page (e.g. a {@link PageHeader} with a title and status chips). */
  header: ReactNode;
  /** The right-hand properties rail. Omit for a single-column detail. */
  aside?: ReactNode;
  /** The main content column. */
  children: ReactNode;
  /** Extra container classes (e.g. a print scope). */
  className?: string;
}

/**
 * The standard entity-detail arrangement: container → header → a two-column grid of a flexible
 * content column beside a fixed properties rail.
 *
 * @remarks
 * Separates the two-column detail *arrangement* — shared by every entity detail page — from the
 * page-specific content that fills it. The page composes its own header and passes its body and
 * rail as slots; the column widths, gaps, and stacking behavior live here once.
 */
export function DetailPageLayout({
  header,
  aside,
  children,
  className,
}: DetailPageLayoutProps): JSX.Element {
  return (
    <PageContainer className={className}>
      {header}
      <div className="grid grid-cols-1 gap-6 @4xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-4">{children}</div>
        {aside ? <aside className="flex flex-col gap-4">{aside}</aside> : null}
      </div>
    </PageContainer>
  );
}
