/** Receipt validation utility for object commands. */

import type { ObjectCommandReceipt } from '../../contracts/object-command';

/** Create a validation error for receipt issues. */
export function ownedValidation(message: string, path: (string | number)[] = []): Error {
  return new Error(message + (path.length > 0 ? ` (at ${path.join('.')})` : ''));
}

/**
 * Validate that status property changes are complete tuples (all status fields present exactly once).
 * Prevents partial or duplicate status updates.
 */
export function assertReceiptStatusTupleShape(receipt: ObjectCommandReceipt): void {
  const properties =
    receipt.objectKind === 'task'
      ? ['state', 'statusId', 'completedAt', 'canceledAt']
      : ['status', 'statusId'];
  const propertySet = new Set(properties);
  const countsByObject = new Map<string, Map<string, number>>();
  for (const entry of receipt.entries) {
    if (entry.kind !== 'object' || !propertySet.has(entry.property)) continue;
    const counts = countsByObject.get(entry.objectId) ?? new Map<string, number>();
    counts.set(entry.property, (counts.get(entry.property) ?? 0) + 1);
    countsByObject.set(entry.objectId, counts);
  }
  for (const counts of countsByObject.values()) {
    if (
      receipt.action !== 'replace_property' ||
      properties.some((property) => counts.get(property) !== 1)
    ) {
      throw ownedValidation('Receipt contains an incomplete or duplicate status tuple');
    }
  }
}

/**
 * Validate that project timeframe property changes are complete tuples (all three fields present exactly once).
 * Prevents partial timeframe updates on projects.
 */
export function assertReceiptTimeframeTupleShape(receipt: ObjectCommandReceipt): void {
  if (receipt.objectKind !== 'project') return;
  for (const properties of [
    ['startDate', 'startDateResolution', 'startDateFiscalYearStartMonth'],
    ['targetDate', 'targetDateResolution', 'targetDateFiscalYearStartMonth'],
  ]) {
    const propertySet = new Set(properties);
    const countsByObject = new Map<string, Map<string, number>>();
    for (const entry of receipt.entries) {
      if (entry.kind !== 'object' || !propertySet.has(entry.property)) continue;
      const counts = countsByObject.get(entry.objectId) ?? new Map<string, number>();
      counts.set(entry.property, (counts.get(entry.property) ?? 0) + 1);
      countsByObject.set(entry.objectId, counts);
    }
    for (const counts of countsByObject.values()) {
      if (
        receipt.action !== 'replace_property' ||
        properties.some((property) => counts.get(property) !== 1)
      ) {
        throw ownedValidation('Receipt contains an incomplete or duplicate Project timeframe');
      }
    }
  }
}
