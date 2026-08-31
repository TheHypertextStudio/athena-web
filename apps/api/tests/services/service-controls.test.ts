import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import {
  readLatticeServiceControls,
  readServiceControl,
  setServiceControl,
} from '../../src/services/service-controls';
import { getDb, seedStaffUser } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

beforeEach(async () => {
  await db.delete(schema.serviceControl);
});

describe('service controls', () => {
  it('reads an unset control as enabled so a fresh deployment runs the capability', async () => {
    await expect(readServiceControl('lattice_polling')).resolves.toBe(true);
    await expect(readLatticeServiceControls()).resolves.toEqual({
      pollingEnabled: true,
      submissionsEnabled: true,
    });
  });

  it('reads a stored disabled control back as disabled', async () => {
    await db.insert(schema.serviceControl).values({ key: 'lattice_polling', enabled: false });

    await expect(readServiceControl('lattice_polling')).resolves.toBe(false);
    // The other key still has no row, so it stays on its in-code default.
    await expect(readLatticeServiceControls()).resolves.toEqual({
      pollingEnabled: false,
      submissionsEnabled: true,
    });
  });

  it('reads a stored enabled control back as enabled', async () => {
    await db.insert(schema.serviceControl).values({ key: 'lattice_submissions', enabled: true });

    await expect(readServiceControl('lattice_submissions')).resolves.toBe(true);
    await expect(readLatticeServiceControls()).resolves.toEqual({
      pollingEnabled: true,
      submissionsEnabled: true,
    });
  });

  it('stores an operator decision and reads it back, keeping one row per control', async () => {
    const { staffUserId } = await seedStaffUser(db, schema, 'superadmin');

    await expect(setServiceControl('lattice_submissions', false, staffUserId)).resolves.toBe(false);
    await expect(readServiceControl('lattice_submissions')).resolves.toBe(false);

    await expect(setServiceControl('lattice_submissions', true, staffUserId)).resolves.toBe(true);
    await expect(readServiceControl('lattice_submissions')).resolves.toBe(true);

    const rows = await db.select().from(schema.serviceControl);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: 'lattice_submissions',
      enabled: true,
      updatedBy: staffUserId,
    });
  });

  it('accepts a stored decision with no staff identity attached', async () => {
    await expect(setServiceControl('lattice_polling', false, null)).resolves.toBe(false);

    const rows = await db.select().from(schema.serviceControl);
    expect(rows[0]).toMatchObject({ key: 'lattice_polling', enabled: false, updatedBy: null });
  });
});
