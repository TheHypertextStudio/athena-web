import { TabsScope, surfaceToneVariable } from '@docket/ui/primitives';
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
import { cn } from '@docket/ui/lib/utils';

import {
  createContext,
  type CSSProperties,
  type JSX,
  type ReactNode,
  type RefObject,
  useContext,
  useLayoutEffect,
  useMemo,
} from 'react';

import { OBJECT_PAGE_ATTRIBUTE, objectTargetProps, type ObjectRef } from '@/lib/actions/object';

import { CompactDetailHeader, FullDetailMasthead } from './entity-detail-header-content';
import { useDetailHeaderCollapse } from './entity-detail-collapse';
import { EntityDetailObjectContext } from './entity-detail-context';
import { useElementWidth } from './use-element-width';

/** Props for {@link EntityDetailLayout}. */
export interface EntityDetailLayoutProps {
  /** Keep a collection-focused section's identity compact while preserving the full Overview masthead. */
  headerDensity?: 'full' | 'compact';
  /** Keep icon, title and actions together instead of using the expanded stacked identity. */
  identityLayout?: 'stacked' | 'inline';
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
  /** Optional quiet work-type identity, outside the title heading. */
  typeLabel?: ReactNode;
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
export type DetailHeaderProps = Pick<
  EntityDetailLayoutProps,
  | 'cover'
  | 'eyebrow'
  | 'icon'
  | 'title'
  | 'subtitle'
  | 'metadata'
  | 'actions'
  | 'tabs'
  | 'headerDensity'
  | 'identityLayout'
  | 'typeLabel'
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
  headerDensity,
  identityLayout = 'stacked',
  headerRef,
  cover,
  eyebrow,
  icon,
  title,
  typeLabel,
  subtitle,
  metadata,
  actions,
  tabs,
  object,
  hasPrintSummary,
}: DetailHeaderProps): JSX.Element {
  if (headerDensity === 'compact')
    return (
      <CompactDetailHeader
        {...{ headerRef, icon, title, metadata, actions, tabs, object, hasPrintSummary }}
      />
    );
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
      <FullDetailMasthead
        {...{ cover, eyebrow, icon, title, typeLabel, subtitle, metadata, actions, identityLayout }}
      />

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
  headerDensity = 'full',
  identityLayout = 'stacked',
  cover,
  eyebrow,
  icon,
  title,
  typeLabel,
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
  const { scrollRef, headerRef } = useDetailHeaderCollapse({
    hasCover: Boolean(cover),
    layoutKey: headerDensity,
  });
  const docked = useAsideDocked(scrollRef, aside !== undefined);
  const asideState = useMemo<EntityDetailAsideState>(() => ({ docked }), [docked]);

  return (
    <TabsScope>
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
              headerDensity={headerDensity}
              identityLayout={identityLayout}
              headerRef={headerRef}
              cover={cover}
              eyebrow={eyebrow}
              icon={icon}
              title={title}
              typeLabel={typeLabel}
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
    </TabsScope>
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

export {
  EntityMetadataItem,
  EntityMetadataRow,
  fitEntityMetadataPriority,
  type EntityMetadataPriority,
  type EntityMetadataItemWidth,
  type FitEntityMetadataPriorityOptions,
  type EntityMetadataItemProps,
  type EntityMetadataRowProps,
} from './entity-detail-metadata';
