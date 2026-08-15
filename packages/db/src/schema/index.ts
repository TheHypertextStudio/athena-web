/**
 * `@docket/db` — schema barrel. Re-exports every enum + table from every island so
 * both the drizzle client (`schema` namespace) and drizzle-kit (migration codegen)
 * see the complete set of `pgEnum`s and `pgTable`s from one entry.
 */
export * from '../enums';
export * from './auth';
export * from './identity';
export * from './crosscutting';
export * from './notion-mirror';
export * from './work-status';
export * from './work';
export * from './joins';
export * from './agents';
export * from './elicitation';
export * from './admin';
export * from './billing';
export * from './infra';
export * from './work-location';
export * from './calendar';
export * from './work-location-sync';
export * from './event';
export * from './resources';
export * from './search';
export * from './time';
export * from './mcp';
export * from './mcp-tasks';
export * from './change-set';
export * from './publishing';
export * from './phone';
export * from './scheduling';
export * from './athena-mail';
export * from './recurrence';
