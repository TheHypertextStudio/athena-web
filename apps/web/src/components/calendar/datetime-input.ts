/**
 * `calendar/datetime-input` — conversion helpers between an ISO instant and a native
 * `<input type="datetime-local">` value.
 *
 * @remarks
 * `datetime-local` inputs read/write a zone-less local string (`YYYY-MM-DDTHH:mm`); the wire
 * format is always a zoned ISO instant. Shared by the item workspace drawer's core-fields form and
 * the create-native-block form so both edit times the same way.
 */

/** Convert an ISO instant to a `datetime-local` input value in the viewer's local timezone. */
export function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Convert a `datetime-local` input value (local time) back to an ISO instant. */
export function fromLocalInputValue(value: string): string {
  return new Date(value).toISOString();
}
