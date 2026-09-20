import { ValidationError } from '../error';

/** Project a stored timestamp onto the calendar day it names. */
export function dayOf(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(0, 10);
}

/** Reject a mutation that would leave a task due before its anticipated start. */
export function assertTaskWindowOrdered(
  before: { startDate: Date | null; dueDate: Date | null },
  patch: { startDate?: Date | null; dueDate?: Date | null },
): void {
  const start = dayOf(patch.startDate === undefined ? before.startDate : patch.startDate);
  const due = dayOf(patch.dueDate === undefined ? before.dueDate : patch.dueDate);
  if (start === null || due === null || due >= start) return;
  throw new ValidationError([
    {
      message: 'Due date cannot fall before the anticipated start date',
      path: [patch.dueDate === undefined ? 'startDate' : 'dueDate'],
    },
  ]);
}
