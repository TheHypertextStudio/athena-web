/**
 * `@docket/api` — instance-wide service controls, read live from the database.
 *
 * @remarks
 * Each control is a product setting an operator changes from the admin console, so a running
 * deployment switches a capability off (and back on) without a redeploy. A key with no stored row
 * reads as enabled, which keeps the product default in code: a fresh deployment runs the
 * capability before anyone has opened the console, and a row appears only once an operator has
 * actually decided something. Reads hit the database on every call — the Lattice sweep runs every
 * few minutes, so a plain SELECT per tick sees an operator's change immediately and there is no
 * cache to invalidate.
 */
import { db, serviceControl, type ServiceControlKey } from '@docket/db';
import { eq, inArray } from 'drizzle-orm';

/** The two controls governing Athena's durable Lattice work. */
export interface LatticeServiceControls {
  /** Whether the sweep polls and settles Lattice work that has already been submitted. */
  readonly pollingEnabled: boolean;
  /** Whether the sweep submits new durable work to personal Lattice runtimes. */
  readonly submissionsEnabled: boolean;
}

/** Keys backing {@link readLatticeServiceControls}. */
const LATTICE_CONTROL_KEYS = [
  'lattice_submissions',
  'lattice_polling',
] as const satisfies readonly ServiceControlKey[];

/**
 * Read one service control.
 *
 * @param key - The control to read.
 * @returns The stored value, or `true` when no operator has stored one.
 */
export async function readServiceControl(key: ServiceControlKey): Promise<boolean> {
  const rows = await db
    .select({ enabled: serviceControl.enabled })
    .from(serviceControl)
    .where(eq(serviceControl.key, key))
    .limit(1);
  return rows[0]?.enabled ?? true;
}

/**
 * Read both Lattice controls in the shape the delegation sweep takes.
 *
 * @returns Each control's stored value, defaulting to enabled where no row exists.
 */
export async function readLatticeServiceControls(): Promise<LatticeServiceControls> {
  const rows = await db
    .select({ key: serviceControl.key, enabled: serviceControl.enabled })
    .from(serviceControl)
    .where(inArray(serviceControl.key, [...LATTICE_CONTROL_KEYS]));
  const stored = new Map(rows.map((row) => [row.key, row.enabled]));
  return {
    pollingEnabled: stored.get('lattice_polling') ?? true,
    submissionsEnabled: stored.get('lattice_submissions') ?? true,
  };
}

/**
 * Store one operator's decision for a service control.
 *
 * @param key - The control being set.
 * @param enabled - The value the runtime should read from now on.
 * @param updatedBy - Staff user making the change, or null when no operator identity applies.
 * @returns The value now stored for the control.
 */
export async function setServiceControl(
  key: ServiceControlKey,
  enabled: boolean,
  updatedBy: string | null,
): Promise<boolean> {
  const rows = await db
    .insert(serviceControl)
    .values({ key, enabled, updatedBy })
    .onConflictDoUpdate({
      target: serviceControl.key,
      set: { enabled, updatedBy, updatedAt: new Date() },
    })
    .returning({ enabled: serviceControl.enabled });
  return rows[0]?.enabled ?? enabled;
}
