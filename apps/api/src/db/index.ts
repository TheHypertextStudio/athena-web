/**
 * Database connection configuration.
 *
 * @packageDocumentation
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../lib/env.js';
import * as schema from './schema/index.js';

const connectionString = env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required');
}

const client = postgres(connectionString);

export const db = drizzle(client, { schema });

export type Database = typeof db;
