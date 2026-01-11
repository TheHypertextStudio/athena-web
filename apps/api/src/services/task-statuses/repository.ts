/**
 * Task status repository - database operations for custom task statuses.
 *
 * @packageDocumentation
 */

import { eq, and, asc } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { customTaskStatuses, workspaces } from '../../db/schema/index.js';
import type { TaskStatusCategory } from './schemas.js';

export interface TaskStatusRecord {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  category: TaskStatusCategory;
  color: string;
  icon: string | null;
  position: number;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskStatusListFilters {
  workspaceId: string;
  category?: TaskStatusCategory;
}

export interface CreateTaskStatusData {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  category: TaskStatusCategory;
  color: string;
  icon?: string;
  position: number;
  isDefault: boolean;
}

export interface UpdateTaskStatusData {
  name?: string;
  description?: string | null;
  color?: string;
  icon?: string | null;
}

export class TaskStatusRepository {
  /**
   * Find all custom statuses for a workspace.
   */
  async findMany(filters: TaskStatusListFilters): Promise<TaskStatusRecord[]> {
    const { workspaceId, category } = filters;

    let whereClause = eq(customTaskStatuses.workspaceId, workspaceId);

    if (category) {
      const combined = and(whereClause, eq(customTaskStatuses.category, category));
      if (combined) whereClause = combined;
    }

    const results = await db
      .select()
      .from(customTaskStatuses)
      .where(whereClause)
      .orderBy(asc(customTaskStatuses.category), asc(customTaskStatuses.position));

    return results as TaskStatusRecord[];
  }

  /**
   * Find a status by ID.
   */
  async findById(id: string): Promise<TaskStatusRecord | null> {
    const [result] = await db
      .select()
      .from(customTaskStatuses)
      .where(eq(customTaskStatuses.id, id))
      .limit(1);

    return result ? (result as TaskStatusRecord) : null;
  }

  /**
   * Find the default status for a category in a workspace.
   */
  async findDefaultForCategory(
    workspaceId: string,
    category: TaskStatusCategory,
  ): Promise<TaskStatusRecord | null> {
    const [result] = await db
      .select()
      .from(customTaskStatuses)
      .where(
        and(
          eq(customTaskStatuses.workspaceId, workspaceId),
          eq(customTaskStatuses.category, category),
          eq(customTaskStatuses.isDefault, true),
        ),
      )
      .limit(1);

    return result ? (result as TaskStatusRecord) : null;
  }

  /**
   * Get the next position for a category in a workspace.
   */
  async getNextPosition(workspaceId: string, category: TaskStatusCategory): Promise<number> {
    const results = await db
      .select({ position: customTaskStatuses.position })
      .from(customTaskStatuses)
      .where(
        and(
          eq(customTaskStatuses.workspaceId, workspaceId),
          eq(customTaskStatuses.category, category),
        ),
      )
      .orderBy(asc(customTaskStatuses.position));

    if (results.length === 0) return 0;
    return Math.max(...results.map((r) => r.position)) + 1;
  }

  /**
   * Create a new custom status.
   */
  async create(data: CreateTaskStatusData): Promise<TaskStatusRecord> {
    const [result] = await db
      .insert(customTaskStatuses)
      .values({
        id: data.id,
        workspaceId: data.workspaceId,
        name: data.name,
        description: data.description,
        category: data.category,
        color: data.color,
        icon: data.icon,
        position: data.position,
        isDefault: data.isDefault,
      })
      .returning();

    return result as TaskStatusRecord;
  }

  /**
   * Create multiple statuses at once (for workspace initialization).
   */
  async createMany(statuses: CreateTaskStatusData[]): Promise<TaskStatusRecord[]> {
    if (statuses.length === 0) return [];

    const results = await db.insert(customTaskStatuses).values(statuses).returning();

    return results as TaskStatusRecord[];
  }

  /**
   * Update a status.
   */
  async update(id: string, data: UpdateTaskStatusData): Promise<TaskStatusRecord | null> {
    const [result] = await db
      .update(customTaskStatuses)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(customTaskStatuses.id, id))
      .returning();

    return result ? (result as TaskStatusRecord) : null;
  }

  /**
   * Delete a status.
   */
  async delete(id: string): Promise<boolean> {
    const result = await db
      .delete(customTaskStatuses)
      .where(eq(customTaskStatuses.id, id))
      .returning({ id: customTaskStatuses.id });

    return result.length > 0;
  }

  /**
   * Update the position of a status.
   */
  async updatePosition(id: string, position: number): Promise<void> {
    await db
      .update(customTaskStatuses)
      .set({ position, updatedAt: new Date() })
      .where(eq(customTaskStatuses.id, id));
  }

  /**
   * Set a status as the default for its category.
   * Clears any existing default for that category in the workspace.
   */
  async setAsDefault(id: string, workspaceId: string, category: TaskStatusCategory): Promise<void> {
    // First, clear any existing defaults for this category
    await db
      .update(customTaskStatuses)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(
        and(
          eq(customTaskStatuses.workspaceId, workspaceId),
          eq(customTaskStatuses.category, category),
          eq(customTaskStatuses.isDefault, true),
        ),
      );

    // Then set the new default
    await db
      .update(customTaskStatuses)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(eq(customTaskStatuses.id, id));
  }

  /**
   * Check if a workspace has any custom statuses.
   */
  async hasStatuses(workspaceId: string): Promise<boolean> {
    const [result] = await db
      .select({ id: customTaskStatuses.id })
      .from(customTaskStatuses)
      .where(eq(customTaskStatuses.workspaceId, workspaceId))
      .limit(1);

    return !!result;
  }

  /**
   * Get the user's default workspace ID.
   */
  async getDefaultWorkspaceId(userId: string): Promise<string | null> {
    const [result] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.ownerId, userId))
      .limit(1);

    return result?.id ?? null;
  }
}
