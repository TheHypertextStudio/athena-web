/**
 * `views` — the one canonical entity-detail shell that task / project / initiative / program detail
 * pages compose.
 *
 * @remarks
 * Every strategic-work detail page used to hand-roll its own masthead: some put the status chip
 * inline with the title, some hid properties behind a popover, some floated them in a right rail,
 * and the title size drifted between surfaces. {@link EntityDetailLayout} fixes the *arrangement*
 * once — the icon sits above the title + subtitle pair, and the title fills the available width
 * instead of being clipped to a fixed measure — a metadata slot for the full inline property row,
 * then the tab bar, and the active panel — so a page only supplies
 * content through slots. The canonical title token (`text-headline-medium font-medium`) is owned
 * here so no page can diverge from it.
 *
 * A page with properties too many for the metadata row can opt into an aside: a second column
 * beside the body that appears only when the pane is wide enough to hold it, and that the page
 * reads back through {@link useEntityDetailAside} to keep every property on screen exactly once.
 */
import { useOwnPageScroll } from '@docket/ui/components';
import { Ellipsis } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import {
  Button,
  ControlGroup,
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  surfaceToneVariable,
} from '@docket/ui/primitives';
import {
  createContext,
  type CSSProperties,
  type JSX,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { OBJECT_PAGE_ATTRIBUTE, objectTargetProps, type ObjectRef } from '@/lib/actions/object';

import { useDetailHeaderCollapse } from './entity-detail-collapse';
import {
  EntityDetailObjectContext,
  MetadataPlacementContext,
  type OverflowRevealer,
  useMetadataItemPlacement,
  useOverflowDisclosure,
} from './entity-detail-context';
import { useElementWidth } from './use-element-width';

/** Props for {@link EntityDetailLayout}. */
export interface EntityDetailLayoutProps {
  /**
   * A full-bleed banner across the very top of the page, behind everything else.
   *
   * @remarks
   * Edge to edge on purpose. A cover inset inside the content padding is just a picture *in* the
   * page; a cover that spans the top is the page's header, which is the only version worth having.
   * The masthead is pulled up so the icon straddles its lower edge, exactly as a team card does, so
   * identity and cover read as one object rather than a caption under a photograph.
   */
  cover?: ReactNode;
  /** The breadcrumb (e.g. the Initiative breadcrumb), rendered above the identity row. */
  eyebrow?: ReactNode;
  /** The entity icon rendered above the title (an editable picker or a static glyph, ~40px). */
  icon: ReactNode;
  /** The title content (e.g. an inline-editable title); the layout owns the canonical token. */
  title: ReactNode;
  /** The one-line summary rendered directly under the identity pair. */
  subtitle?: ReactNode;
  /** The inline metadata row — typically an {@link EntityMetadataRow} of property pickers. */
  metadata?: ReactNode;
  /** Masthead actions (e.g. publish and ⋯), aligned with the icon/title identity row. */
  actions?: ReactNode;
  /** The tab bar (a `Tabs` element). It ends the sticky header, which lifts tonally on scroll. */
  tabs: ReactNode;
  /** The active tab panel's content. */
  children: ReactNode;
  /**
   * A second column beside the body, docked only while the pane is at least
   * {@link ENTITY_DETAIL_ASIDE_MIN_WIDTH} wide.
   *
   * @remarks
   * Opt-in: a page that passes nothing lays out exactly as before. While docked the column stays in
   * view under the header as the body scrolls; below the threshold it is not rendered at all, and
   * {@link useEntityDetailAside} reports `docked: false` so the page can carry those properties
   * somewhere else instead. A page must never mount the same control in both places.
   */
  aside?: ReactNode;
  /** Static, document-first content rendered only for print media. */
  printSummary?: ReactNode;
  /** Extra container classes (e.g. a page print scope). */
  className?: string;
  /** Canonical object identity for the shared right-click action surface. */
  object?: ObjectRef;
}

/** Tailwind's `--container-4xl` token (`56rem`), the width of the `@4xl` container-query step. */
const CONTAINER_4XL_REM = 56;

/** The px per rem the framework's container tokens resolve against. */
const REM_PX = 16;

/** The pane width, in px, at which an opted-in aside docks beside the body: the `@4xl` step. */
export const ENTITY_DETAIL_ASIDE_MIN_WIDTH = CONTAINER_4XL_REM * REM_PX;

/**
 * The last width the aside's pane measured, so a detail page opened after another starts from the
 * arrangement the pane is most likely to need instead of the narrow one.
 */
let lastPaneWidth = 0;

/** What a page can read about the aside its layout is holding. */
export interface EntityDetailAsideState {
  /** Whether the aside is docked beside the body right now. */
  readonly docked: boolean;
}

const EntityDetailAsideContext = createContext<EntityDetailAsideState>({ docked: false });

/**
 * Read whether the enclosing {@link EntityDetailLayout} has docked its aside.
 *
 * @remarks
 * Call it from inside a slot (the metadata row, a tab panel): the layout provides the state to
 * everything it renders. Outside a layout, or in one that passed no `aside`, it reports `false`.
 *
 * @returns the aside state.
 */
export function useEntityDetailAside(): EntityDetailAsideState {
  return useContext(EntityDetailAsideContext);
}

/**
 * Track whether the scroll container is wide enough to dock the aside.
 *
 * @param scrollRef - The layout's scroll container.
 * @param enabled - Whether the page opted into an aside at all.
 * @returns `true` while the aside should be docked.
 */
function useAsideDocked(scrollRef: RefObject<HTMLDivElement | null>, enabled: boolean): boolean {
  const width = useElementWidth(scrollRef, enabled, 'self', lastPaneWidth);
  useLayoutEffect(() => {
    if (width > 0) lastPaneWidth = width;
  }, [width]);
  return enabled && width >= ENTITY_DETAIL_ASIDE_MIN_WIDTH;
}

/** Props for {@link DetailHeader}: the layout's masthead slots, plus the collapse hook's ref. */
type DetailHeaderProps = Pick<
  EntityDetailLayoutProps,
  'cover' | 'eyebrow' | 'icon' | 'title' | 'subtitle' | 'metadata' | 'actions' | 'tabs'
> & {
  readonly headerRef: RefObject<HTMLElement | null>;
  readonly object: ObjectRef | undefined;
  readonly hasPrintSummary: boolean;
};

/**
 * The sticky, collapsing header: the masthead band, then the tab bar.
 *
 * @param props - The {@link DetailHeaderProps}.
 * @returns the header element.
 */
function DetailHeader({
  headerRef,
  cover,
  eyebrow,
  icon,
  title,
  subtitle,
  metadata,
  actions,
  tabs,
  object,
  hasPrintSummary,
}: DetailHeaderProps): JSX.Element {
  return (
    <header
      ref={headerRef}
      {...(object ? { ...objectTargetProps(object), [OBJECT_PAGE_ATTRIBUTE]: '' } : {})}
      // The two ends of M3's on-scroll app bar, as roles from the documented ramp rather than as
      // tokens. A static `Surface` cannot express this: the bar interpolates between two tones as
      // the page scrolls, so the tone is an animation rather than a resting class. Naming both
      // ends through `surfaceToneVariable` keeps the *choice* in the component and leaves the
      // stylesheet holding no colour of its own.
      //
      // `floating`, not the `card` that `AppBar` takes, and the difference is what this bar
      // occludes rather than a preference. `AppBar` sits above route content on the `page` step.
      // This bar sits above a detail page whose document body is `EntityDocument` — itself `card`
      // — so a `card` bar and the panel scrolling beneath it are the same tone, and a half-covered
      // heading dissolves into a field with no edge. A bar has to out-rank the furniture it
      // covers, and `floating` is the first step that does.
      style={
        {
          '--detail-bar-resting': `var(${surfaceToneVariable('page')})`,
          '--detail-bar-lifted': `var(${surfaceToneVariable('floating')})`,
        } as CSSProperties
      }
      className={cn(
        'detail-header page-bleed page-grid sticky top-0 isolate z-10 gap-y-0',
        hasPrintSummary ? 'detail-print-hidden' : undefined,
      )}
    >
      {/* The masthead band: the cover, eyebrow, and identity live inside this one wrapper, and
          nothing else does. `.detail-tabs` is this wrapper's sibling, not its descendant, so the
          cover's box structurally ends at the wrapper's bottom edge — there is no lower boundary
          for it to cross, not a z-index or an opaque backing standing in for one. `page-bleed` +
          `page-grid` bleed the wrapper itself edge to edge and then re-open the measure track for
          `eyebrow`/`detail-masthead`, mirroring how `header` does the same thing one level up. */}
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
                <h1 className="detail-title text-on-surface text-headline-medium min-w-0 font-medium">
                  {title}
                </h1>
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

      <div className="detail-tabs min-w-0">{tabs}</div>
    </header>
  );
}

/** Props for {@link DetailBody}: the layout's body slots, plus whether the aside is docked. */
type DetailBodyProps = Pick<EntityDetailLayoutProps, 'printSummary' | 'aside' | 'children'> & {
  readonly docked: boolean;
};

/**
 * The scrolling body: the print brief, then the active panel, beside the aside when it is docked.
 *
 * @param props - The {@link DetailBodyProps}.
 * @returns the body element.
 */
function DetailBody({ printSummary, aside, docked, children }: DetailBodyProps): JSX.Element {
  return (
    // This nested grid preserves the page measure. Its columns, edges, and spacing are specified in
    // `docs/design/references/detail-page-layout.md`.
    <div className="detail-body page-bleed page-grid gap-y-4 @2xl:gap-y-5">
      {printSummary ? <div className="detail-print-summary">{printSummary}</div> : null}
      {aside === undefined ? (
        children
      ) : (
        // A page that opted into an aside keeps one wrapper pair whether or not the aside is
        // docked, so crossing the threshold restyles the wrapper and adds or removes only the
        // aside: the panel is never re-parented, and so is never unmounted and remounted.
        <div
          className={
            docked ? 'grid grid-cols-[minmax(0,1fr)_20rem] items-start gap-x-8' : undefined
          }
        >
          <div className="flex min-w-0 flex-col gap-4 @2xl:gap-5">{children}</div>
          {docked ? (
            // Sticky under the header, whose measured height the collapse hook publishes; the
            // fallback keeps it inert before the first measurement.
            <aside
              aria-label="Details"
              className="no-print sticky top-[calc(var(--detail-header-height,0px)+1rem)] min-w-0"
            >
              {aside}
            </aside>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * The standard entity-detail arrangement.
 *
 * @remarks
 * Renders (top to bottom): an optional eyebrow, a masthead whose primary row holds the identity and
 * actions, the collapsible subtitle/metadata block, the tab bar, and the active panel. The identity
 * owns the remaining width and truncates only at the compact endpoint, so actions never create a
 * second header row. Status/health and every other property live in the metadata slot.
 *
 * @param props - The {@link EntityDetailLayoutProps}.
 * @returns the composed detail page.
 */
export function EntityDetailLayout({
  cover,
  eyebrow,
  icon,
  title,
  subtitle,
  metadata,
  actions,
  tabs,
  children,
  aside,
  printSummary,
  className,
  object,
}: EntityDetailLayoutProps): JSX.Element {
  // Every detail page owns its scrolling, backdrop or not. Making it conditional would mean two
  // layouts again — one that scrolls itself and one the shell scrolls — which is the duplication
  // this component exists to remove. It is also required for a backdrop: the shell's `<main>`
  // reserves a permanent scrollbar gutter while it scrolls, and no child of a gutter-reserving box
  // can reach the pane's edge. Owning the scroll additionally gives the header something to pin to
  // and a timeline to collapse against, which every detail page benefits from equally.
  useOwnPageScroll();
  const { scrollRef, headerRef } = useDetailHeaderCollapse({ hasCover: Boolean(cover) });
  const docked = useAsideDocked(scrollRef, aside !== undefined);
  const asideState = useMemo<EntityDetailAsideState>(() => ({ docked }), [docked]);

  return (
    <EntityDetailObjectContext.Provider value={object ?? null}>
      <EntityDetailAsideContext.Provider value={asideState}>
        <div
          ref={scrollRef}
          data-detail-panel-scroll=""
          data-detail-cover={cover ? 'present' : 'absent'}
          data-detail-print={printSummary ? '' : undefined}
          className={cn(
            // Sections are rows of this grid, so the rhythm between them is declared once here rather
            // than by each section spacing itself against its neighbours. The bottom inset is not one
            // of them: it belongs to `.detail-body`, because this element declares its own container
            // and so can never resolve the `--page-gutter` step its own descendants see.
            'page-grid h-full min-h-0 w-full gap-y-4 overflow-y-auto @2xl:gap-y-5',
            className,
          )}
        >
          {/* Bleeds the full pane so the backdrop can reach both edges, and re-measures its own
            children through the nested grid, so nothing inside has to know it sits in a bleeding
            section. */}
          <DetailHeader
            headerRef={headerRef}
            cover={cover}
            eyebrow={eyebrow}
            icon={icon}
            title={title}
            subtitle={subtitle}
            metadata={metadata}
            actions={actions}
            tabs={tabs}
            object={object}
            hasPrintSummary={Boolean(printSummary)}
          />
          <DetailBody printSummary={printSummary} aside={aside} docked={docked}>
            {children}
          </DetailBody>
        </div>
      </EntityDetailAsideContext.Provider>
    </EntityDetailObjectContext.Provider>
  );
}

/**
 * The shared class for a metadata property chip: a low-chrome pill trigger sized to the inline row.
 *
 * @remarks
 * Pass to each picker's `triggerClassName` (with `triggerVariant="ghost"`) so every property in the
 * metadata row reads as the same calm, tappable chip.
 */
export const ENTITY_METADATA_CHIP_CLASS =
  'bg-surface-container-low hover:bg-surface-container-high min-w-0 max-w-full shrink';

/** Props for {@link EntityMetadataStaticChip}. */
export interface EntityMetadataStaticChipProps {
  /** The property's glyph, drawn from the same source the editable picker's option uses. */
  icon?: ReactNode;
  /** The resolved, human-readable value. */
  label: string;
  /**
   * Names the property this chip states, since the chip itself shows only a value.
   *
   * @remarks
   * Composed with the value into `"<property> — <value>"`, which is the accessible name the
   * picker that replaces this chip builds. Matching it means a screen reader hears the same
   * phrasing before and after the record arrives.
   */
  ariaLabel: string;
}

/**
 * One property stated as a chip, with no affordance to change it.
 *
 * @remarks
 * For the case where a value is known but the control that edits it is not ready — a detail page
 * painting what a navigation snapshot already carries while the aggregate behind its pickers is
 * still in flight. It has to be a separate component rather than a picker in `readOnly` mode:
 * {@link import('@docket/ui/components').PropertyTrigger | PropertyTrigger}'s read-only branch
 * renders a bare span, so the padding that makes a chip a chip comes from the button it does not
 * render, and a row of them would resize the moment the real controls arrived.
 *
 * The geometry below is therefore the trigger button's, copied deliberately, so a chip and the
 * picker that replaces it occupy the same box.
 *
 * @param props - The {@link EntityMetadataStaticChipProps}.
 * @returns the stated property.
 */
export function EntityMetadataStaticChip({
  icon,
  label,
  ariaLabel,
}: EntityMetadataStaticChipProps): JSX.Element {
  return (
    <span
      aria-label={`${ariaLabel} — ${label}`}
      className={cn(
        ENTITY_METADATA_CHIP_CLASS,
        'text-on-surface text-body-medium inline-flex h-auto max-w-full items-center justify-start gap-2 rounded-md px-2 py-1.5',
      )}
    >
      {icon ? (
        <span aria-hidden="true" className="flex shrink-0 items-center">
          {icon}
        </span>
      ) : null}
      <span className="truncate">{label}</span>
    </span>
  );
}

/** Ordered visibility tier for one property in the inline metadata row. */
export type EntityMetadataPriority = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** One measured metadata control used to calculate progressive inline disclosure. */
export interface EntityMetadataItemWidth {
  readonly priority: EntityMetadataPriority;
  readonly width: number;
}

/** Inputs for {@link fitEntityMetadataPriority}. */
export interface FitEntityMetadataPriorityOptions {
  readonly availableWidth: number;
  readonly itemWidths: readonly EntityMetadataItemWidth[];
  readonly gap: number;
  readonly overflowWidth: number;
}

/** Return the highest consecutive priority whose measured controls fit the row. */
export function fitEntityMetadataPriority({
  availableWidth,
  itemWidths,
  gap,
  overflowWidth,
}: FitEntityMetadataPriorityOptions): EntityMetadataPriority {
  if (itemWidths.length === 0) return 0;
  const priorities = [...new Set(itemWidths.map(({ priority }) => priority))].sort(
    (left, right) => left - right,
  );
  const declaredPriority = priorities.at(-1) ?? 0;
  const fullWidth = itemWidths.reduce(
    (total, item, index) => total + item.width + (index === 0 ? 0 : gap),
    0,
  );
  if (fullWidth <= availableWidth) return declaredPriority;

  const inlineWidth = Math.max(0, availableWidth - overflowWidth - gap);
  let usedWidth = 0;
  let usedItems = 0;
  let visiblePriority: EntityMetadataPriority = 0;
  for (const priority of priorities) {
    const items = itemWidths.filter((item) => item.priority === priority);
    const groupWidth = items.reduce(
      (total, item, index) => total + item.width + (index === 0 ? 0 : gap),
      0,
    );
    const nextWidth = usedWidth + (usedItems === 0 ? 0 : gap) + groupWidth;
    if (priority !== 0 && nextWidth > inlineWidth) break;
    usedWidth = nextWidth;
    usedItems += items.length;
    visiblePriority = priority;
  }
  return visiblePriority;
}

interface EntityMetadataLaneContext extends OverflowRevealer {
  readonly lane: 'inline' | 'overflow';
  readonly visiblePriority: EntityMetadataPriority;
  readonly declareItem?: (
    priority: EntityMetadataPriority,
    element: HTMLElement,
    overflowOnly: boolean,
  ) => () => void;
}

const MetadataLaneContext = createContext<EntityMetadataLaneContext | null>(null);

/** Props for {@link EntityMetadataItem}. */
export interface EntityMetadataItemProps {
  /** Lower priorities remain inline at narrower widths; priority zero is always visible. */
  priority: EntityMetadataPriority;
  /** Keep supplemental information in overflow even when the inline row has room. */
  overflowOnly?: boolean;
  /** Optional width policy for property types that must remain intrinsically readable. */
  className?: string;
  /** One property picker or compact read-only value. */
  children: ReactNode;
}

/**
 * Annotate one property for progressive inline disclosure while keeping it in overflow.
 *
 * @param props - The property control and its inline priority.
 * @returns A width-capped metadata item understood by {@link EntityMetadataRow}.
 */
export function EntityMetadataItem({
  priority,
  overflowOnly = false,
  className,
  children,
}: EntityMetadataItemProps): JSX.Element | null {
  const lane = useContext(MetadataLaneContext);
  const itemRef = useRef<HTMLDivElement>(null);
  const declareItem = lane?.lane === 'inline' ? lane.declareItem : undefined;

  useLayoutEffect(() => {
    const element = itemRef.current;
    if (!declareItem || !element) return;
    return declareItem(priority, element, overflowOnly);
  }, [declareItem, overflowOnly, priority]);

  const hiddenInline = lane?.lane === 'inline' && (overflowOnly || priority > lane.visiblePriority);
  const placement = useMetadataItemPlacement(hiddenInline, lane);
  if (lane?.lane === 'overflow' && !overflowOnly && priority <= lane.visiblePriority) return null;

  return (
    <div
      ref={itemRef}
      hidden={hiddenInline}
      data-entity-metadata-item=""
      data-entity-metadata-priority={priority}
      className={cn('max-w-64 min-w-0 shrink-0 items-center [&>*]:min-w-0', className)}
    >
      <MetadataPlacementContext.Provider value={placement}>
        {children}
      </MetadataPlacementContext.Provider>
    </div>
  );
}

/** Props for {@link EntityMetadataRow}. */
export interface EntityMetadataRowProps {
  /** Accessible label for the property group (e.g. "Project properties"). */
  ariaLabel: string;
  /** Additional row styling for the surface that owns these controls. */
  className?: string | undefined;
  /** The property chips (pickers) to lay out inline. */
  children: ReactNode;
}

/** One declared item: its tier, its measured width, and whether it stays out of the inline row. */
interface MetadataMeasurement {
  priority: EntityMetadataPriority;
  width: number;
  overflowOnly: boolean;
}

/**
 * Measure the declared items and decide how many tiers fit the row.
 *
 * @returns the visible tier, whether anything overflows, the item registration callback, and the
 *   setter through which the row reports its available width.
 */
function useMetadataFit() {
  const availableWidth = useRef(0);
  const itemMeasurements = useRef(new Map<HTMLElement, MetadataMeasurement>());
  const [visiblePriority, setVisiblePriority] = useState<EntityMetadataPriority>(7);
  const [declaredPriority, setDeclaredPriority] = useState<EntityMetadataPriority>(0);
  const [hasSupplemental, setHasSupplemental] = useState(false);

  const recomputeVisibility = useCallback(() => {
    const measurements = [...itemMeasurements.current.values()];
    const inlineMeasurements = measurements.filter((item) => !item.overflowOnly);
    const nextDeclared = inlineMeasurements.reduce<EntityMetadataPriority>(
      (highest, item) => Math.max(highest, item.priority) as EntityMetadataPriority,
      0,
    );
    setDeclaredPriority(nextDeclared);
    setHasSupplemental(measurements.some((item) => item.overflowOnly));
    if (availableWidth.current <= 0) {
      setVisiblePriority(nextDeclared);
      return;
    }
    setVisiblePriority(
      fitEntityMetadataPriority({
        availableWidth: availableWidth.current,
        itemWidths: inlineMeasurements,
        // Reserve the shared icon control's 40px coarse-pointer floor. The extra 12px on fine
        // pointers keeps the fit conservative and prevents a pointer-mode change from clipping a
        // property before ResizeObserver reports another row width.
        gap: 6,
        overflowWidth: 40,
      }),
    );
  }, []);

  const declareItem = useCallback(
    (priority: EntityMetadataPriority, element: HTMLElement, overflowOnly: boolean) => {
      const measure = (): void => {
        // A picker can keep its own intrinsic width while its wrapper is clipped by the inline
        // lane. Measure both boxes so the fitter never treats clipped content as free space.
        const width = Math.max(element.getBoundingClientRect().width, element.scrollWidth);
        if (width <= 0 && !overflowOnly) return;
        itemMeasurements.current.set(element, { priority, width, overflowOnly });
        recomputeVisibility();
      };
      measure();
      const observer =
        typeof ResizeObserver === 'undefined'
          ? null
          : new ResizeObserver(() => {
              measure();
            });
      observer?.observe(element);

      return () => {
        observer?.disconnect();
        itemMeasurements.current.delete(element);
        recomputeVisibility();
      };
    },
    [recomputeVisibility],
  );

  const setAvailableWidth = useCallback(
    (width: number): void => {
      availableWidth.current = width;
      recomputeVisibility();
    },
    [recomputeVisibility],
  );

  return {
    visiblePriority,
    hasOverflow: hasSupplemental || declaredPriority > visiblePriority,
    declareItem,
    setAvailableWidth,
  };
}

/**
 * A single-line property row with a stable overflow surface.
 *
 * @remarks
 * Each property is rendered inline at its declared priority and rendered again inside the popover.
 * The popover copy is mounted only while open, so picker state never competes between two live
 * controls. This mirrors the task-header rule: narrow widths remove controls from the row, never
 * from the product.
 *
 * @param props - The {@link EntityMetadataRowProps}.
 * @returns a labelled group wrapping its property chips.
 */
export function EntityMetadataRow({
  ariaLabel,
  className,
  children,
}: EntityMetadataRowProps): JSX.Element {
  const inlineRef = useRef<HTMLDivElement>(null);
  const { visiblePriority, hasOverflow, declareItem, setAvailableWidth } = useMetadataFit();

  // The row's own width, read before the first paint: without it `availableWidth` stays at its
  // initial `0` and `visiblePriority` at its "show everything" default, so every pill renders inline
  // and the row's `overflow-hidden` clips whichever ones don't fit instead of demoting them into
  // the overflow popover.
  //
  // Only a positive width is forwarded. A `0` means the row has no layout to measure (detached, or a
  // test environment with no layout engine), and recomputing against that non-answer would collapse
  // the row to its priority-zero items instead of leaving it at the "show everything" default.
  const rowWidth = useElementWidth(inlineRef, true, 'parent');
  useLayoutEffect(() => {
    if (rowWidth > 0) setAvailableWidth(rowWidth);
  }, [rowWidth, setAvailableWidth]);

  const overflow = useOverflowDisclosure();
  const revealOverflow = overflow.reveal;
  const inlineLane = useMemo<EntityMetadataLaneContext>(
    () => ({ lane: 'inline', visiblePriority, declareItem, revealOverflow }),
    [declareItem, revealOverflow, visiblePriority],
  );
  const overflowLane = useMemo<EntityMetadataLaneContext>(
    () => ({ lane: 'overflow', visiblePriority }),
    [visiblePriority],
  );

  return (
    <ControlGroup
      role="group"
      aria-label={ariaLabel}
      controlSize="sm"
      className={cn('entity-metadata-row min-w-0 flex-nowrap', className)}
    >
      <div ref={inlineRef} className="min-w-0 flex-1 overflow-hidden">
        <ControlGroup data-entity-metadata-inline="" className="flex-nowrap">
          <MetadataLaneContext.Provider value={inlineLane}>{children}</MetadataLaneContext.Provider>
        </ControlGroup>
      </div>
      {hasOverflow ? (
        <Popover open={overflow.open} onOpenChange={overflow.setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              iconOnly
              className="shrink-0"
              aria-label={`More ${ariaLabel}`}
            >
              <Ellipsis aria-hidden />
            </Button>
          </PopoverTrigger>
          <PopoverContent presentation="panel" width="xl" align="end">
            <PopoverBody>
              <ControlGroup
                role="group"
                aria-label={`More ${ariaLabel}`}
                controlSize="sm"
                orientation="vertical"
                data-entity-metadata-overflow=""
                className="min-w-0 items-stretch"
              >
                <MetadataLaneContext.Provider value={overflowLane}>
                  {children}
                </MetadataLaneContext.Provider>
              </ControlGroup>
            </PopoverBody>
          </PopoverContent>
        </Popover>
      ) : null}
    </ControlGroup>
  );
}
