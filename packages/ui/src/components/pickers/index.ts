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
 * - {@link DatePicker} / {@link DateRangePicker} — native ISO date / date-range fields.
 */
export { ActorPicker, type ActorPickerProps } from './ActorPicker';
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
export { OptionPicker, type OptionPickerProps } from './OptionPicker';
export { PickerList, type PickerListProps } from './PickerList';
export { PropertyTrigger, type PropertyTriggerProps } from './PropertyTrigger';
export { type PickerOption, optionMatches } from './types';
