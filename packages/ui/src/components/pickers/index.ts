/**
 * `@docket/ui` — barrel for the compact inline property pickers.
 *
 * @remarks
 * The presentational picker shells reused by BOTH the detail property panels and the create
 * composers. Every picker is a compact trigger ({@link PropertyTrigger}) that shows the
 * current value or a calm settable affordance, opening a focused, keyboard-navigable
 * menu/popover that reports a selection through `onChange`. The shells take *pre-resolved*
 * options and never touch app data — app-data-bound wrappers in `apps/web` feed them
 * members/projects/etc. and own the optimistic PATCH.
 *
 * - {@link PropertyTrigger} — the shared compact trigger (value chip ↔ "Set <field>" prompt).
 * - {@link PickerList} — the searchable, roving listbox engine inside a popover.
 * - {@link OptionPicker} — generic searchable single-select (engine for actor/entity).
 * - {@link EnumPicker} — short unsearchable enum menu (status / priority / health).
 * - {@link ActorPicker} — searchable actor preset (assignee / lead / owner).
 * - {@link EntityPicker} — searchable entity preset (project / program / initiative / cycle / team).
 * - {@link LabelsPicker} — searchable multi-select labels.
 * - {@link DatePicker} / {@link DateRangePicker} — the ISO date / date-range pickers.
 * - {@link CalendarGrid} — the keyboard-operable month grid both date pickers are built on.
 * - `calendar-date` — pure calendar-day arithmetic and the one safe day formatter.
 */
export { ActorPicker, type ActorPickerProps } from './ActorPicker';
export { CalendarGrid, type CalendarGridProps } from './CalendarGrid';
export {
  addDays,
  addMonths,
  CALENDAR_MAX_DAY,
  CALENDAR_MIN_DAY,
  type CalendarCell,
  type CalendarDate,
  clampIso,
  compareIso,
  DAYS_PER_WEEK,
  daysInMonth,
  endOfMonth,
  formatCalendarDay,
  isIsoDate,
  localeWeekStart,
  monthGrid,
  monthLabel,
  parseIsoDate,
  startOfMonth,
  toCalendarDay,
  toIso,
  todayIso,
  weekdayLabels,
  weekdayOf,
} from './calendar-date';
export {
  DatePicker,
  type DatePickerProps,
  type DateRange,
  DateRangePicker,
  type DateRangePickerProps,
} from './DatePicker';
export { EntityPicker, type EntityPickerProps } from './EntityPicker';
export { EnumPicker, type EnumPickerProps } from './EnumPicker';
export { LabelsPicker, type LabelsPickerProps } from './LabelsPicker';
export { EntityMultiPicker, type EntityMultiPickerProps } from './EntityMultiPicker';
export { OptionPicker, type OptionPickerProps } from './OptionPicker';
export { PickerList, type PickerListProps } from './PickerList';
export { PropertyTrigger, type PropertyTriggerProps } from './PropertyTrigger';
export {
  TimeframePicker,
  type TimeframePickerProps,
  TimeframeRangePicker,
  type TimeframeRangePickerProps,
  type TimeframeRangeValue,
} from './TimeframePicker';
export {
  nearbyTimeframeOptions,
  type TimeframeOption,
  timeframeResolutionMonths,
} from './timeframe-options';
export { type PickerOption, optionMatches } from './types';
