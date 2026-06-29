/**
 * `@docket/db` — Drizzle schema, the driver-select client, ULID generator, enums,
 * jsonb shapes, and relations. The single SQL owner for the whole monorepo.
 *
 * @remarks
 * Import tables/enums/types from here (`import { task, db, genId } from '@docket/db'`).
 * The `db` client is lazy, so importing this barrel is side-effect-free.
 */
export { genId } from './id';
export { db, fullSchema } from './client';
export type { Database } from './client';
export * from './types';
export * from './schema';
export * from './relations';
export {
  STAFF_ROLES,
  DEFAULT_STAFF_ROLE,
  isStaffRole,
  grantStaffByEmail,
  parseStaffTarget,
  parseStaffTargets,
  roleForEmail,
  bootstrapRoleFor,
  type StaffRole,
  type StaffTarget,
  type GrantStaffOptions,
  type GrantStaffResult,
} from './seed';
