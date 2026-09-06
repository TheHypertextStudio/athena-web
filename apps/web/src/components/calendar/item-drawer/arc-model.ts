/**
 * `calendar/item-drawer/arc-model` — an event read as before, during, and after.
 *
 * @remarks
 * The data already told this story and the interface hid it. `CalendarItemTaskRole` has been
 * `prep`, `agenda`, `follow_up`, and `outcome` since linked tasks landed — the work you do to get
 * ready, the work the event itself is for, what it leaves you with, and what came of it — and the
 * drawer rendered that as a `<select>` labelled "New task relationship". `CalendarItemRelationRole`
 * adds `follow_up`, described in the contract as a scheduler-created debrief, and the drawer
 * filtered it out entirely, so the week scheduler has been writing links no surface displays.
 *
 * Pure and React-free on purpose: the peek summarises the same arc without mounting any of it.
 */
import type {
  CalendarItemLinkedTaskOut,
  CalendarItemRelationOut,
  CalendarItemRelationRole,
  CalendarItemTaskRole,
} from '@docket/planning/calendar-contract';

/** Where in an event's arc a piece of work sits. */
export type ArcBandId = 'before' | 'during' | 'after' | 'related';

/** The bands in reading order. */
export const ARC_BAND_IDS: readonly ArcBandId[] = ['before', 'during', 'after', 'related'];

/** The heading each band carries. */
export const ARC_BAND_LABEL: Record<ArcBandId, string> = {
  before: 'Before',
  during: 'During',
  after: 'After',
  related: 'Related',
};

/** What the add affordance in each band offers to create. */
export const ARC_BAND_ADD_LABEL: Record<ArcBandId, string> = {
  before: 'Add prep',
  during: 'Add to the agenda',
  after: 'Add follow-up',
  related: 'Link related work',
};

/** The task role a band creates when someone adds work to it. */
export const ARC_BAND_TASK_ROLE: Record<ArcBandId, CalendarItemTaskRole> = {
  before: 'prep',
  during: 'agenda',
  after: 'follow_up',
  related: 'related',
};

const BAND_BY_TASK_ROLE: Record<CalendarItemTaskRole, ArcBandId> = {
  prep: 'before',
  agenda: 'during',
  contained: 'during',
  follow_up: 'after',
  outcome: 'after',
  related: 'related',
};

const BAND_BY_RELATION_ROLE: Record<CalendarItemRelationRole, ArcBandId> = {
  contained: 'during',
  follow_up: 'after',
  related: 'related',
};

/** One band's contents. */
export interface ArcBand {
  readonly id: ArcBandId;
  readonly label: string;
  readonly tasks: readonly CalendarItemLinkedTaskOut[];
  readonly relations: readonly CalendarItemRelationOut[];
  /** Whether this band has nothing to show. */
  readonly empty: boolean;
}

/** An event's whole arc. */
export interface EventArc {
  readonly bands: readonly ArcBand[];
  /** Whether nothing at all is attached to this event. */
  readonly empty: boolean;
}

/** Inputs for {@link buildEventArc}. */
export interface BuildEventArcInput {
  readonly linkedTasks: readonly CalendarItemLinkedTaskOut[];
  readonly relations: readonly CalendarItemRelationOut[];
}

/**
 * Sort an event's linked work into the arc it already implies.
 *
 * @param input - The event's linked tasks and outgoing relationships.
 * @returns every band in reading order, each knowing whether it is empty.
 */
export function buildEventArc({ linkedTasks, relations }: BuildEventArcInput): EventArc {
  const bands = ARC_BAND_IDS.map((id): ArcBand => {
    const tasks = linkedTasks.filter((task) => BAND_BY_TASK_ROLE[task.role] === id);
    const bandRelations = relations.filter(
      (relation) => BAND_BY_RELATION_ROLE[relation.role] === id,
    );
    return {
      id,
      label: ARC_BAND_LABEL[id],
      tasks,
      relations: bandRelations,
      empty: tasks.length === 0 && bandRelations.length === 0,
    };
  });
  return { bands, empty: bands.every((band) => band.empty) };
}

/**
 * Count what is attached to an event, for a surface too small to list it.
 *
 * @param input - The event's linked tasks, and its relationships when the caller has them.
 * @returns one count per band.
 */
export function eventArcCounts(input: BuildEventArcInput): Record<ArcBandId, number> {
  const arc = buildEventArc(input);
  return Object.fromEntries(
    arc.bands.map((band) => [band.id, band.tasks.length + band.relations.length]),
  ) as Record<ArcBandId, number>;
}
