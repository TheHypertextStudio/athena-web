/**
 * `@docket/db` — schema barrel. Re-exports every enum + table from every island so
 * both the drizzle client (`schema` namespace) and drizzle-kit (migration codegen)
 * see the complete set of `pgEnum`s and `pgTable`s from one entry.
 */
export * from '../enums';
export * from './auth';
export * from './identity';
export * from './crosscutting';
export * from './work';
export * from './joins';
export * from './agents';
export * from './admin';
export * from './infra';
export * from './calendar';
export * from './event';
export * from './search';
export * from './time';
