/**
 * The product app's single entry point for choosing and displaying a calendar day.
 *
 * @remarks
 * Two rules, and they are the whole point of this module existing:
 *
 * 1. **Every surface that lets a person set a day imports {@link DatePicker} or
 *    {@link DateRangePicker} from here.** There is one picker implementation
 *    (`@docket/ui/components/pickers/DatePicker`), so open/select/commit/dismiss/keyboard
 *    behaviour cannot vary between the task rail, the project timeline, the cycle window, and
 *    the triage lane. Before this, five surfaces hosted their own bare `<input type="date">`
 *    and each behaved differently.
 * 2. **Every surface that *shows* a day formats it with {@link formatDay} or
 *    {@link formatDayRange}.** Both return `null` for anything unreadable instead of the string
 *    `"Invalid Date"` that `new Date(x).toLocaleDateString()` produces and React renders
 *    verbatim. The author's requirement is that no such thing exists in this product; the way
 *    to guarantee that is to make the broken string unreachable rather than to remember to
 *    guard at ~40 call sites.
 *
 * The bounds a picker offers are the same bounds the DTOs enforce, so a picker can never
 * produce a date the API will refuse — see {@link DATE_PICKER_MIN} / {@link DATE_PICKER_MAX}.
 *
 * @see `docs/design/audits/date-pickers.md` for the call-site inventory this module governs.
 */
export {
  CalendarGrid,
  type CalendarGridProps,
  DatePicker,
  type DatePickerProps,
  type DateRange,
  DateRangePicker,
  type DateRangePickerProps,
} from '@docket/ui/components';

export { DATE_PICKER_MAX, DATE_PICKER_MIN, formatDay, formatDayRange, toDay } from './format-day';
