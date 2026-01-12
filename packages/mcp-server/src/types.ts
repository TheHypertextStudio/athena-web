import type { AnyColumn } from 'drizzle-orm/column';

/**
 * Minimal Drizzle query API needed by the MCP server.
 */
export interface AthenaMcpDbQuery {
  findMany: (args: Record<string, unknown>) => Promise<Record<string, unknown>[]>;
  findFirst: (args: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
}

/**
 * Minimal Drizzle DB API used by the MCP server.
 */
export interface AthenaMcpDb {
  query: {
    tasks: AthenaMcpDbQuery;
    projects: AthenaMcpDbQuery;
    events: AthenaMcpDbQuery;
    initiatives: AthenaMcpDbQuery;
    userSettings: AthenaMcpDbQuery;
  };
  insert: (table: unknown) => {
    values: (
      values: Record<string, unknown>,
    ) => Promise<unknown> | { returning: (fields?: Record<string, unknown>) => Promise<unknown[]> };
  };
  update: (table: unknown) => {
    set: (values: Record<string, unknown>) => {
      where: (condition: unknown) => Promise<unknown>;
    };
  };
}

export interface TasksTable {
  id: AnyColumn;
  title: AnyColumn;
  description: AnyColumn;
  priority: AnyColumn;
  deadline: AnyColumn;
  status: AnyColumn;
  creatorId: AnyColumn;
  projectId: AnyColumn;
  createdAt: AnyColumn;
  updatedAt: AnyColumn;
  deletedAt: AnyColumn;
}

export interface ProjectsTable {
  id: AnyColumn;
  ownerId: AnyColumn;
  initiativeId: AnyColumn;
  createdAt: AnyColumn;
  deletedAt: AnyColumn;
}

export interface EventsTable {
  id: AnyColumn;
  creatorId: AnyColumn;
  startTime: AnyColumn;
  endTime: AnyColumn;
}

export interface InitiativesTable {
  id: AnyColumn;
  ownerId: AnyColumn;
  createdAt: AnyColumn;
  deletedAt: AnyColumn;
}

export interface UserSettingsTable {
  userId: AnyColumn;
}

/**
 * Schema references required by the MCP server for Drizzle conditions.
 */
export interface AthenaMcpSchema {
  tasks: TasksTable;
  projects: ProjectsTable;
  events: EventsTable;
  initiatives: InitiativesTable;
  userSettings: UserSettingsTable;
}

/**
 * Options for creating an Athena MCP server instance.
 */
export interface CreateAthenaMcpServerOptions {
  userId: string;
  db: AthenaMcpDb;
  schema: AthenaMcpSchema;
}
