import type { JSX } from 'react';
import { Surface } from '@docket/ui/primitives';
import { cn } from '@docket/ui/lib/utils';
import { OBJECT_PAGE_ATTRIBUTE, objectTargetProps } from '@/lib/actions/object';
import type { DetailHeaderProps } from './entity-detail-layout';
/** Compact identity and section navigation for collection-focused detail sections. */
export function CompactDetailHeader({
  headerRef,
  icon,
  title,
  metadata,
  actions,
  tabs,
  object,
  hasPrintSummary,
}: DetailHeaderProps): JSX.Element {
  return (
    <header
      ref={headerRef}
      className={cn(
        'page-bleed sticky top-0 z-10',
        hasPrintSummary ? 'detail-print-hidden' : undefined,
      )}
    >
      <Surface
        {...(object ? { ...objectTargetProps(object), [OBJECT_PAGE_ATTRIBUTE]: '' } : {})}
        tone="page"
        shape="none"
        className="page-grid gap-y-2 py-3"
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="shrink-0">{icon}</div>
          <h1 className="text-title-large min-w-0 flex-1 break-words">{title}</h1>
          {actions ? (
            <div
              role="group"
              aria-label="Entity actions"
              className="flex shrink-0 items-center gap-1"
            >
              {actions}
            </div>
          ) : null}
        </div>
        {metadata ? <div className="min-w-0">{metadata}</div> : null}
        <div className="min-w-0">{tabs}</div>
      </Surface>
    </header>
  );
}

/** The original full masthead body, preserving its shared identity and collapse structure. */
export function FullDetailMasthead({
  cover,
  eyebrow,
  icon,
  title,
  subtitle,
  metadata,
  actions,
}: Pick<
  DetailHeaderProps,
  'cover' | 'eyebrow' | 'icon' | 'title' | 'subtitle' | 'metadata' | 'actions'
>): JSX.Element {
  return (
    <div className="masthead-band page-bleed page-grid relative isolate gap-y-0">
      {/* The backdrop is a layer of this band, not a section above it. `isolate` (on the band,
            not the header) traps it in the band's own stacking context, so it cannot paint over
            anything outside the band — including `detail-tabs`, which sits outside it entirely.
            It has no height of its own: it is whatever the band is, so collapsing the header
            collapses the artwork with it.

            `page-bleed`: without it this div is still a `.page-grid` child like any other, so the
            blanket `.page-grid > *` rule silently placed it on the gutter-inset `measure` track —
            `inset-0` was flush with that track, not with the band, so the cover sat inside a
            margin on both sides no matter how full-bleed the band itself was. `rounded-t-xl`
            matches `<main>`'s own corner radius exactly, so the now-genuinely-flush cover
            terminates at the panel's real top corners on purpose instead of getting clipped to
            them by accident. */}
      {cover ? (
        <div className="page-bleed absolute inset-0 -z-10 overflow-hidden rounded-t-xl">
          {cover}
        </div>
      ) : null}

      {/* `.masthead-content` carries the indent that used to sit on `.detail-header` itself
            (`padding-block-start`). It has to live here, as a sibling of the cover rather than an
            ancestor of it — the cover is `inset-0` against `.masthead-band`, so any padding on
            *that* element would push the cover down with it and reopen the exact gap this whole
            restructuring exists to close. */}
      <div className="masthead-content">
        {eyebrow ? <div className="mb-3 min-w-0">{eyebrow}</div> : null}

        {cover ? <div aria-hidden="true" className="detail-backdrop-space" /> : null}

        <div className="detail-masthead">
          <div className="detail-primary">
            <div className="detail-identity">
              <div className="detail-glyph">{icon}</div>
              <h1 className="detail-title text-on-surface text-headline-medium min-w-0">{title}</h1>
            </div>
            {actions ? (
              <div
                aria-label="Entity actions"
                className="detail-actions flex shrink-0 items-center gap-1"
                role="group"
              >
                {actions}
              </div>
            ) : null}
          </div>

          <div className="detail-secondary">
            <div className="flex min-w-0 flex-col gap-3">
              {subtitle ? (
                <div className="text-on-surface-variant text-body-large min-w-0">{subtitle}</div>
              ) : null}
              {metadata}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
