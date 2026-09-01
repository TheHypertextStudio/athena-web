/**
 * Provider amounts, formatted for an operator.
 *
 * @remarks
 * Stripe reports money in minor units, and both billing surfaces in this console — an
 * organization's discount preview and the finance discount queue — render the same two sentences
 * from it. Kept here so there is one of each rather than a copy per screen.
 */

/** A provider credit, as the billing responses report it. */
export interface ProviderCredit {
  /** The amount in minor units (cents for USD). */
  readonly totalAmount: number;
  /** The ISO currency code, in whatever case the provider used. */
  readonly currency: string;
}

/** Minor units per major unit. Every currency Stripe reports here uses two decimal places. */
const MINOR_UNITS_PER_MAJOR = 100;

/**
 * Format a minor-unit provider amount as currency.
 *
 * @param minorUnits - The amount in minor units.
 * @param currency - The ISO currency code.
 * @returns the localized amount, e.g. `$4.32`.
 */
export function money(minorUnits: number, currency: string): string {
  return (minorUnits / MINOR_UNITS_PER_MAJOR).toLocaleString(undefined, {
    style: 'currency',
    currency: currency.toUpperCase(),
  });
}

/**
 * What credit a previewed or issued discount involves, in one line.
 *
 * @param credit - The credit the provider reported, if any.
 * @returns the line shown under a discount preview.
 */
export function creditLine(credit: ProviderCredit | null | undefined): string {
  if (!credit) return 'No current-invoice credit is required.';
  return `Credit preview: ${money(credit.totalAmount, credit.currency)}`;
}
