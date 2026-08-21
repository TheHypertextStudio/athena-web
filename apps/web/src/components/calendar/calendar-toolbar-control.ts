/**
 * Shared responsive geometry for labelled controls in the Calendar toolbar.
 *
 * @remarks
 * The toolbar has six controls plus one flexible heading. At the narrowest width each control is a
 * 40px square. A 22rem container steps the controls up to 44px touch targets, and `@2xl` compacts
 * them to 32px once labels become visible. The explicit minimum widths keep controls present while
 * the heading absorbs the remaining squeeze. The toolbar's `flex-nowrap` rule keeps them on one
 * row.
 *
 * This module lives under `components/calendar` because both route-owned controls and the shared
 * creation form use the same geometry. Keep the recipe here instead of making a component module
 * import an App Router module.
 */
export const CALENDAR_CONTROL_CLASS =
  'min-h-10 w-10 min-w-10 shrink gap-1.5 px-2 [&_svg]:size-4 @min-[22rem]:min-h-11 @min-[22rem]:w-11 @min-[22rem]:min-w-11 @2xl:min-h-8 @2xl:w-auto @2xl:min-w-8 @2xl:shrink-0 @2xl:px-3';
