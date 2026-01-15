/**
 * Initiative status repository - database operations for custom initiative statuses.
 *
 * @packageDocumentation
 */

import { eq, and, asc } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { customInitiativeStatuses, workspaces } from '../../db/schema/index.js';
import type { InitiativeStatusCategory } from './schemas.js';

export interface InitiativeStatusRecord {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  category: InitiativeStatusCategory;
  color: string;
  icon: string | null;
  position: number;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface InitiativeStatusListFilters {
  workspaceId: string;
  category?: InitiativeStatusCategory;
}

export interface CreateInitiativeStatusData {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  category: InitiativeStatusCategory;
  color: string;
  icon?: string;
  position: number;
  isDefault: boolean;
}

export interface UpdateInitiativeStatusData {
  name?: string;
  description?: string | null;
  color?: string;
  icon?: string | null;
}

export class InitiativeStatusRepository {
  /**
   * Find all custom statuses for a workspace.
   */
  async findMany(filters: InitiativeStatusListFilters): Promise<InitiativeStatusRecord[]> {
    const { workspaceId, category } = filters;

    let whereClause = eq(customInitiativeStatuses.workspaceId, workspaceId);

    if (category) {
      const combined = and(whereClause, eq(customInitiativeStatuses.category, category));
      if (combined) whereClause = combined;
    }

    const results = await db
      .select()
      .from(customInitiativeStatuses)
      .where(whereClause)
      .orderBy(asc(customInitiativeStatuses.category), asc(customInitiativeStatuses.position));

    return results as InitiativeStatusRecord[];
  }

  /**
   * Find a status by ID.
   */
  async findById(id: string): Promise<InitiativeStatusRecord | null> {
    const [result] = await db
      .select()
      .from(customInitiativeStatuses)
      .where(eq(customInitiativeStatuses.id, id))
      .limit(1);

    return result ? (result as InitiativeStatusRecord) : null;
  }

  /**
   * Find the default status for a category in a workspace.
   */
  async findDefaultForCategory(
    workspaceId: string,
    category: InitiativeStatusCategory,
  ): Promise<InitiativeStatusRecord | null> {
    const [result] = await db
      .select()
      .from(customInitiativeStatuses)
      .where(
        and(
          eq(customInitiativeStatuses.workspaceId, workspaceId),
          eq(customInitiativeStatuses.category, category),
          eq(customInitiativeStatuses.isDefault, true),
        ),
      )
      .limit(1);

    return result ? (result as InitiativeStatusRecord) : null;
  }

  /**
   * Get the next position for a category in a workspace.
   */
  async getNextPosition(workspaceId: string, category: InitiativeStatusCategory): Promise<number> {
    const results = await db
      .select({ position: customInitiativeStatuses.position })
      .from(customInitiativeStatuses)
      .where(
        and(
          eq(customInitiativeStatuses.workspaceId, workspaceId),
          eq(customInitiativeStatuses.category, category),
        ),
      )
      .orderBy(asc(customInitiativeStatuses.position));

    if (results.length === 0) return 0;
    return Math.max(...results.map((r) => r.position)) + 1;
  }

  /**
   * Create a new custom status.
   */
  async create(data: CreateInitiativeStatusData): Promise<InitiativeStatusRecord> {
    const [result] = await db
      .insert(customInitiativeStatuses)
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

    return result as InitiativeStatusRecord;
  }

  /**
   * Create multiple statuses at once (for workspace initialization).
   */
  async createMany(statuses: CreateInitiativeStatusData[]): Promise<InitiativeStatusRecord[]> {
    if (statuses.length === 0) return [];

    const results = await db.insert(customInitiativeStatuses).values(statuses).returning();

    return results as InitiativeStatusRecord[];
  }

  /**
   * Update a status.
   */
  async update(
    id: string,
    data: UpdateInitiativeStatusData,
  ): Promise<InitiativeStatusRecord | null> {
    const [result] = await db
      .update(customInitiativeStatuses)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(customInitiativeStatuses.id, id))
      .returning();

    return result ? (result as InitiativeStatusRecord) : null;
  }

  /**
   * Delete a status.
   */
  async delete(id: string): Promise<boolean> {
    const result = await db
      .delete(customInitiativeStatuses)
      .where(eq(customInitiativeStatuses.id, id))
      .returning({ id: customInitiativeStatuses.id });

    return result.length > 0;
  }

  /**
   * Update the position of a status.
   */
  async updatePosition(id: string, position: number): Promise<void> {
    await db
      .update(customInitiativeStatuses)
      .set({ position, updatedAt: new Date() })
      .where(eq(customInitiativeStatuses.id, id));
  }

  /**
   * Set a status as the default for its category.
   * Clears any existing default for that category in the workspace.
   */
  async setAsDefault(
    id: string,
    workspaceId: string,
    category: InitiativeStatusCategory,
  ): Promise<void> {
    // First, clear any existing defaults for this category
    await db
      .update(customInitiativeStatuses)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(
        and(
          eq(customInitiativeStatuses.workspaceId, workspaceId),
          eq(customInitiativeStatuses.category, category),
          eq(customInitiativeStatuses.isDefault, true),
        ),
      );

    // Then set the new default
    await db
      .update(customInitiativeStatuses)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(eq(customInitiativeStatuses.id, id));
  }

  /**
   * Check if a workspace has any custom statuses.
   */
  async hasStatuses(workspaceId: string): Promise<boolean> {
    const [result] = await db
      .select({ id: customInitiativeStatuses.id })
      .from(customInitiativeStatuses)
      .where(eq(customInitiativeStatuses.workspaceId, workspaceId))
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
