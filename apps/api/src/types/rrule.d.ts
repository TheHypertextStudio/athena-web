/**
 * Type declarations for optional rrule module.
 *
 * This allows the recurrence service to work even when rrule is not installed.
 */

declare module 'rrule' {
  export interface Options {
    freq?: number;
    dtstart?: Date | null;
    interval?: number;
    wkst?: number | null;
    count?: number | null;
    until?: Date | null;
    tzid?: string | null;
    bysetpos?: number | number[] | null;
    bymonth?: number | number[] | null;
    bymonthday?: number | number[] | null;
    bynmonthday?: number[] | null;
    byyearday?: number | number[] | null;
    byweekno?: number | number[] | null;
    byweekday?: number | number[] | null;
    bynweekday?: number[][] | null;
    byhour?: number | number[] | null;
    byminute?: number | number[] | null;
    bysecond?: number | number[] | null;
    byeaster?: number | null;
  }

  export class RRule {
    constructor(options: Partial<Options>, noCache?: boolean);
    origOptions: Partial<Options>;
    all(iterator?: (date: Date, i: number) => boolean): Date[];
    between(after: Date, before: Date, inc?: boolean): Date[];
    after(dt: Date, inc?: boolean): Date | null;
    before(dt: Date, inc?: boolean): Date | null;
    toText(): string;
    toString(): string;
    static YEARLY: number;
    static MONTHLY: number;
    static WEEKLY: number;
    static DAILY: number;
    static HOURLY: number;
    static MINUTELY: number;
    static SECONDLY: number;
    static MO: number;
    static TU: number;
    static WE: number;
    static TH: number;
    static FR: number;
    static SA: number;
    static SU: number;
  }

  export class RRuleSet {
    rrule(rrule: RRule): void;
    rdate(date: Date): void;
    exdate(date: Date): void;
    exrule(rrule: RRule): void;
    all(iterator?: (date: Date, i: number) => boolean): Date[];
    between(after: Date, before: Date, inc?: boolean): Date[];
    after(dt: Date, inc?: boolean): Date | null;
    before(dt: Date, inc?: boolean): Date | null;
  }

  export function rrulestr(s: string, options?: { dtstart?: Date }): RRule | RRuleSet;
}
