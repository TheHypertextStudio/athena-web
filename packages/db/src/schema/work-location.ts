/**
 * `@docket/db` — user-scoped canonical work-location storage.
 *
 * @remarks
 * This island owns arbitrary saved places, the independent optional home designation, explicit
 * one-off/weekly assertions, their exceptions, and short-lived current-location evidence. It has
 * no provider vocabulary; account mappings and delivery state live in `work-location-sync`.
 */
import type { WorkLocationOccurrenceException, WorkLocationSchedule } from '@docket/types';
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { genId } from '../id';
import { hub } from './identity';

/** One arbitrary user-named regular place. */
export const workPlace = pgTable(
  'work_place',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    hubId: text('hub_id')
      .notNull()
      .references(() => hub.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    geofenceLatitude: doublePrecision('geofence_latitude'),
    geofenceLongitude: doublePrecision('geofence_longitude'),
    geofenceRadiusMeters: doublePrecision('geofence_radius_meters'),
    sort: integer('sort').notNull().default(0),
    archivedAt: timestamp('archived_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('work_place_hub_sort_idx').on(t.hubId, t.sort),
    unique('work_place_hub_id_uq').on(t.hubId, t.id),
    check('work_place_name_nonempty', sql`length(trim(${t.name})) > 0`),
    check('work_place_sort_nonnegative', sql`${t.sort} >= 0`),
    check(
      'work_place_geofence_shape_check',
      sql`(
        ${t.geofenceLatitude} IS NULL AND ${t.geofenceLongitude} IS NULL AND ${t.geofenceRadiusMeters} IS NULL
      ) OR (
        ${t.geofenceLatitude} BETWEEN -90 AND 90 AND
        ${t.geofenceLongitude} BETWEEN -180 AND 180 AND
        ${t.geofenceRadiusMeters} BETWEEN 50 AND 2000
      )`,
    ),
  ],
);

/** The optional singular home designation, separate from saved-place identity. */
export const workLocationProfile = pgTable(
  'work_location_profile',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    hubId: text('hub_id')
      .notNull()
      .references(() => hub.id, { onDelete: 'cascade' }),
    homePlaceId: text('home_place_id'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('work_location_profile_hub_uq').on(t.hubId),
    foreignKey({
      columns: [t.hubId, t.homePlaceId],
      foreignColumns: [workPlace.hubId, workPlace.id],
      name: 'work_location_profile_home_place_fk',
    }).onDelete('restrict'),
  ],
);

/** One canonical one-off assertion or weekly location series. */
export const workLocationAssertion = pgTable(
  'work_location_assertion',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    hubId: text('hub_id')
      .notNull()
      .references(() => hub.id, { onDelete: 'cascade' }),
    placeId: text('place_id').notNull(),
    schedule: jsonb('schedule').$type<WorkLocationSchedule>().notNull(),
    origin: text('origin').notNull().default('docket'),
    originProvider: text('origin_provider'),
    originConnectionId: text('origin_connection_id'),
    revision: integer('revision').notNull().default(1),
    sourceUpdatedAt: timestamp('source_updated_at'),
    archivedAt: timestamp('archived_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('work_location_assertion_hub_idx').on(t.hubId),
    index('work_location_assertion_hub_updated_idx').on(t.hubId, t.updatedAt),
    uniqueIndex('work_location_assertion_hub_id_uq').on(t.hubId, t.id),
    foreignKey({
      columns: [t.hubId, t.placeId],
      foreignColumns: [workPlace.hubId, workPlace.id],
      name: 'work_location_assertion_place_fk',
    }).onDelete('restrict'),
    check('work_location_assertion_revision_positive', sql`${t.revision} > 0`),
    check('work_location_assertion_origin_check', sql`${t.origin} IN ('docket', 'provider')`),
  ],
);

/** One cancelled or replaced local-date occurrence of a weekly series. */
export const workLocationException = pgTable(
  'work_location_exception',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    hubId: text('hub_id')
      .notNull()
      .references(() => hub.id, { onDelete: 'cascade' }),
    assertionId: text('assertion_id')
      .notNull()
      .references(() => workLocationAssertion.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    action: text('action').notNull(),
    replacementPlaceId: text('replacement_place_id'),
    replacementSchedule:
      jsonb('replacement_schedule').$type<
        Extract<WorkLocationOccurrenceException, { action: 'replace' }>['schedule']
      >(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('work_location_exception_assertion_date_uq').on(t.assertionId, t.date),
    index('work_location_exception_hub_date_idx').on(t.hubId, t.date),
    foreignKey({
      columns: [t.hubId, t.replacementPlaceId],
      foreignColumns: [workPlace.hubId, workPlace.id],
      name: 'work_location_exception_replacement_place_fk',
    }).onDelete('restrict'),
    check('work_location_exception_action_check', sql`${t.action} IN ('cancel', 'replace')`),
    check(
      'work_location_exception_shape_check',
      sql`(
        ${t.action} = 'cancel' AND ${t.replacementPlaceId} IS NULL AND ${t.replacementSchedule} IS NULL
      ) OR (
        ${t.action} = 'replace' AND ${t.replacementPlaceId} IS NOT NULL AND ${t.replacementSchedule} IS NOT NULL
      )`,
    ),
  ],
);

/** One short-lived current-location fact; never stores raw observation coordinates. */
export const workLocationObservation = pgTable(
  'work_location_observation',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    hubId: text('hub_id')
      .notNull()
      .references(() => hub.id, { onDelete: 'cascade' }),
    placeId: text('place_id').notNull(),
    source: text('source').notNull(),
    accuracyMeters: doublePrecision('accuracy_meters'),
    observedAt: timestamp('observed_at').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('work_location_observation_hub_fresh_idx').on(t.hubId, t.expiresAt, t.observedAt),
    foreignKey({
      columns: [t.hubId, t.placeId],
      foreignColumns: [workPlace.hubId, workPlace.id],
      name: 'work_location_observation_place_fk',
    }).onDelete('cascade'),
    check('work_location_observation_source_check', sql`${t.source} IN ('manual', 'device')`),
    check(
      'work_location_observation_accuracy_nonnegative',
      sql`${t.accuracyMeters} IS NULL OR ${t.accuracyMeters} >= 0`,
    ),
    check('work_location_observation_time_check', sql`${t.expiresAt} > ${t.observedAt}`),
  ],
);
