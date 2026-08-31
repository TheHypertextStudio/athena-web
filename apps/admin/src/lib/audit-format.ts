/**
 * Presentation helpers for operator audit events.
 *
 * @remarks
 * Audit event types are free-form strings the API may extend at any time (`billing.reconciled`,
 * `impersonation.started`, `staff.granted`, …). These helpers are deliberately generic rather than
 * a lookup table of known types: a table would render an unrecognised future event as a blank or a
 * raw identifier, and the audit log is the one screen where an unfamiliar entry is the most
 * important thing on it.
 */

/** Title-case the first letter of a string, leaving the rest alone. */
function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

/**
 * A readable phrase for an audit-event type.
 *
 * @param type - The stored event type, e.g. `billing.trial_extended`.
 * @returns the phrase, e.g. `Billing trial extended`.
 */
export function auditTypeLabel(type: string): string {
  return capitalize(type.replaceAll('.', ' ').replaceAll('_', ' '));
}

/**
 * A readable phrase for the kind of thing an event acted on.
 *
 * @param subjectType - The stored subject type, e.g. `staff_user`.
 * @returns the phrase, e.g. `Staff user`.
 */
export function auditSubjectLabel(subjectType: string): string {
  return capitalize(subjectType.replaceAll('_', ' '));
}

/** One metadata entry, flattened for display. */
export interface AuditMetadataEntry {
  /** The readable field name. */
  readonly label: string;
  /** The value, rendered as text. */
  readonly value: string;
}

/**
 * Flatten an event's free-form metadata into readable label/value pairs.
 *
 * @remarks
 * Replaces `JSON.stringify(metadata)` truncated into a single line, which was unreadable at exactly
 * the moment it mattered. Primitive values are rendered directly; a nested object or array is
 * serialized, because an audit record must never silently drop a field it did not expect.
 *
 * @param metadata - The event's metadata object.
 * @returns the entries in key order, or an empty array when there is no metadata.
 */
export function auditMetadataEntries(
  metadata: Readonly<Record<string, unknown>>,
): readonly AuditMetadataEntry[] {
  return Object.entries(metadata).map(([key, value]) => ({
    label: capitalize(key.replaceAll('_', ' ')),
    value: formatMetadataValue(value),
  }));
}

/** Render one metadata value as text, without losing anything unexpected. */
function formatMetadataValue(value: unknown): string {
  if (value === null) return 'None';
  if (value === undefined) return 'Not set';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}
