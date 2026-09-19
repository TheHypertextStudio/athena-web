/** Shape validation for object command receipts before they are replayed. */
import { z } from 'zod';

import type { ObjectCommandReceipt } from '../../contracts/object-command';
import { ValidationError } from '../../error';
import { MAX_OBJECT_COMMAND_BYTES } from '../http-limits';
import type { CommandEntry } from './types';
import { PROJECT_PROPERTIES, TASK_PROPERTIES } from './value-transform';

/** Build a validation error this route owns the copy for, rather than echoing a parser message. */
export function ownedValidation(message: string, path: (string | number)[] = []): ValidationError {
  return new ValidationError(new z.ZodError([{ code: 'custom', path, message, input: undefined }]));
}

// JSON escapes each NUL as six ASCII bytes, so this maximizes a valid 200-code-unit command id.
const WORST_VALID_REPLAY_COMMAND_ID = '\0'.repeat(200);

/** Reject a forward receipt that the command endpoint could not accept back for undo. */
export function assertReceiptFitsReplayEnvelope(receipt: ObjectCommandReceipt): void {
  const envelope = {
    commandId: WORST_VALID_REPLAY_COMMAND_ID,
    direction: 'undo',
    receipt,
  } as const;
  if (new TextEncoder().encode(JSON.stringify(envelope)).byteLength > MAX_OBJECT_COMMAND_BYTES) {
    throw ownedValidation('Command receipt is too large to replay');
  }
}

function assertObjectEntryShape(receipt: ObjectCommandReceipt, property: string): void {
  const allowed = receipt.objectKind === 'task' ? TASK_PROPERTIES : PROJECT_PROPERTIES;
  if (!allowed.has(property)) {
    throw ownedValidation('Receipt contains an unsupported property');
  }
  if (property === 'archivedAt' && !['trash', 'restore'].includes(receipt.action)) {
    throw ownedValidation('Receipt action does not match its archived field');
  }
  if (property === 'parentTaskId' && receipt.action !== 'change_parent') {
    throw ownedValidation('Receipt action does not match its hierarchy field');
  }
  if (!['archivedAt', 'parentTaskId'].includes(property) && receipt.action !== 'replace_property') {
    throw ownedValidation('Receipt action does not match its property fields');
  }
}

/** Reject a receipt entry whose property or relation contradicts the receipt's action. */
export function validateReceiptEntryShape(
  receipt: ObjectCommandReceipt,
  entry: CommandEntry,
): void {
  if (entry.kind === 'object') {
    assertObjectEntryShape(receipt, entry.property);
    return;
  }
  if (entry.relation === 'initiative' && receipt.objectKind !== 'project') {
    throw ownedValidation('Receipt contains an unsupported relation');
  }
  if (entry.relation === 'dependency') {
    if (!['add_dependency', 'remove_dependency'].includes(receipt.action)) {
      throw ownedValidation('Receipt action does not match its dependency relation');
    }
    return;
  }
  if (!['add_association', 'remove_association'].includes(receipt.action)) {
    throw ownedValidation('Receipt action does not match its association relation');
  }
}

/**
 * Reject a receipt that carries a partial or duplicated copy of a property group that only ever
 * moves together, such as a status tuple or a Project timeframe.
 */
function assertCompleteTupleShape(
  receipt: ObjectCommandReceipt,
  properties: readonly string[],
  message: string,
): void {
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
      throw ownedValidation(message);
    }
  }
}

/** Reject a receipt whose entries fail any shape rule the replay path depends on. */
export function validateReplayReceipt(receipt: ObjectCommandReceipt): void {
  assertCompleteTupleShape(
    receipt,
    receipt.objectKind === 'task'
      ? ['state', 'statusId', 'completedAt', 'canceledAt']
      : ['status', 'statusId'],
    'Receipt contains an incomplete or duplicate status tuple',
  );
  if (receipt.objectKind === 'project') {
    for (const properties of [
      ['startDate', 'startDateResolution', 'startDateFiscalYearStartMonth'],
      ['targetDate', 'targetDateResolution', 'targetDateFiscalYearStartMonth'],
    ]) {
      assertCompleteTupleShape(
        receipt,
        properties,
        'Receipt contains an incomplete or duplicate Project timeframe',
      );
    }
  }
  for (const entry of receipt.entries) validateReceiptEntryShape(receipt, entry);
}

/** Read an optional id out of a receipt value, rejecting anything that is not a string or null. */
export function receiptId(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value === 'string') return value;
  throw ownedValidation(`Receipt contains an invalid ${field}`);
}
