import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import {
  notificationTriageSettings,
  notificationTriageEvent,
  personalInboundReceipt,
} from '../../src/schema';

describe('personal inbound ownership and retention schema', () => {
  it('resolves the lazy ownership and retention references', () => {
    for (const table of [
      notificationTriageSettings,
      notificationTriageEvent,
      personalInboundReceipt,
    ]) {
      for (const key of getTableConfig(table).foreignKeys) {
        expect(key.reference().foreignTable).toBeDefined();
      }
    }
  });

  it('ties notification triage to retained owner content and account deletion', () => {
    const settings = getTableConfig(notificationTriageSettings);
    expect(settings.foreignKeys.map((key) => key.onDelete)).toEqual(['cascade', 'set null']);
    const events = getTableConfig(notificationTriageEvent);
    expect(events.primaryKeys[0]?.columns.map((column) => column.name)).toEqual([
      'hub_id',
      'notification_id',
    ]);
    expect(events.foreignKeys.every((key) => key.onDelete === 'cascade')).toBe(true);
    const receipt = getTableConfig(personalInboundReceipt);
    expect(receipt.primaryKeys[0]?.columns.map((column) => column.name)).toEqual([
      'hub_id',
      'event_id',
    ]);
    expect(receipt.foreignKeys.map((key) => key.onDelete)).toEqual(['cascade']);
  });
});
