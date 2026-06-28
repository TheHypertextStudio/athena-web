/**
 * External ID mapping service for bi-directional sync.
 *
 * @packageDocumentation
 */

import { db } from '../../db/index.js';
import { externalIdMappings } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';

export type EntityType = 'task' | 'project' | 'event' | 'activity' | 'initiative';
export type SyncDirection = 'inbound' | 'outbound' | 'bidirectional';

export interface ExternalMapping {
  id: string;
  integrationId: string;
  entityType: EntityType;
  localEntityId: string;
  externalId: string;
  syncDirection: SyncDirection;
  lastSyncedFromExternal: Date | null;
  lastSyncedToExternal: Date | null;
  externalVersion: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateMappingOptions {
  integrationId: string;
  entityType: EntityType;
  localEntityId: string;
  externalId: string;
  syncDirection?: SyncDirection;
  externalVersion?: string;
  metadata?: Record<string, unknown>;
}

/**
 * External ID mapping service for tracking relationships between
 * local entities and external service entities.
 */
export class MappingService {
  /**
   * Create a new mapping between a local entity and an external entity.
   */
  async createMapping(options: CreateMappingOptions): Promise<ExternalMapping> {
    const id = crypto.randomUUID();
    const now = new Date();

    await db.insert(externalIdMappings).values({
      id,
      integrationId: options.integrationId,
      entityType: options.entityType,
      localEntityId: options.localEntityId,
      externalId: options.externalId,
      syncDirection: options.syncDirection ?? 'bidirectional',
      externalVersion: options.externalVersion ?? null,
      metadata: options.metadata ?? null,
      createdAt: now,
      updatedAt: now,
    });

    return this.getMappingById(id) as Promise<ExternalMapping>;
  }

  /**
   * Get a mapping by its ID.
   */
  async getMappingById(id: string): Promise<ExternalMapping | null> {
    const result = await db.query.externalIdMappings.findFirst({
      where: eq(externalIdMappings.id, id),
    });

    return result ? this.mapToExternalMapping(result) : null;
  }

  /**
   * Find a mapping by external ID.
   */
  async findByExternalId(
    integrationId: string,
    externalId: string,
  ): Promise<ExternalMapping | null> {
    const result = await db.query.externalIdMappings.findFirst({
      where: and(
        eq(externalIdMappings.integrationId, integrationId),
        eq(externalIdMappings.externalId, externalId),
      ),
    });

    return result ? this.mapToExternalMapping(result) : null;
  }

  /**
   * Find a mapping by local entity.
   */
  async findByLocalEntity(
    integrationId: string,
    entityType: EntityType,
    localEntityId: string,
  ): Promise<ExternalMapping | null> {
    const result = await db.query.externalIdMappings.findFirst({
      where: and(
        eq(externalIdMappings.integrationId, integrationId),
        eq(externalIdMappings.entityType, entityType),
        eq(externalIdMappings.localEntityId, localEntityId),
      ),
    });

    return result ? this.mapToExternalMapping(result) : null;
  }

  /**
   * Get all mappings for an integration.
   */
  async getMappingsForIntegration(integrationId: string): Promise<ExternalMapping[]> {
    const results = await db.query.externalIdMappings.findMany({
      where: eq(externalIdMappings.integrationId, integrationId),
    });

    return results.map((r) => this.mapToExternalMapping(r));
  }

  /**
   * Get all mappings for a local entity across all integrations.
   */
  async getMappingsForEntity(
    entityType: EntityType,
    localEntityId: string,
  ): Promise<ExternalMapping[]> {
    const results = await db.query.externalIdMappings.findMany({
      where: and(
        eq(externalIdMappings.entityType, entityType),
        eq(externalIdMappings.localEntityId, localEntityId),
      ),
    });

    return results.map((r) => this.mapToExternalMapping(r));
  }

  /**
   * Update the last synced timestamp for inbound sync.
   */
  async markSyncedFromExternal(mappingId: string, externalVersion?: string): Promise<void> {
    const now = new Date();
    await db
      .update(externalIdMappings)
      .set({
        lastSyncedFromExternal: now,
        externalVersion: externalVersion ?? undefined,
        updatedAt: now,
      })
      .where(eq(externalIdMappings.id, mappingId));
  }

  /**
   * Update the last synced timestamp for outbound sync.
   */
  async markSyncedToExternal(mappingId: string, externalVersion?: string): Promise<void> {
    const now = new Date();
    await db
      .update(externalIdMappings)
      .set({
        lastSyncedToExternal: now,
        externalVersion: externalVersion ?? undefined,
        updatedAt: now,
      })
      .where(eq(externalIdMappings.id, mappingId));
  }

  /**
   * Update the external version (e.g., after detecting remote changes).
   */
  async updateExternalVersion(mappingId: string, externalVersion: string): Promise<void> {
    await db
      .update(externalIdMappings)
      .set({
        externalVersion,
        updatedAt: new Date(),
      })
      .where(eq(externalIdMappings.id, mappingId));
  }

  /**
   * Delete a mapping.
   */
  async deleteMapping(mappingId: string): Promise<void> {
    await db.delete(externalIdMappings).where(eq(externalIdMappings.id, mappingId));
  }

  /**
   * Delete all mappings for a local entity.
   */
  async deleteMappingsForEntity(entityType: EntityType, localEntityId: string): Promise<void> {
    await db
      .delete(externalIdMappings)
      .where(
        and(
          eq(externalIdMappings.entityType, entityType),
          eq(externalIdMappings.localEntityId, localEntityId),
        ),
      );
  }

  /**
   * Get or create a mapping - idempotent operation.
   */
  async getOrCreateMapping(options: CreateMappingOptions): Promise<ExternalMapping> {
    // Check if mapping already exists
    const existing = await this.findByExternalId(options.integrationId, options.externalId);
    if (existing) {
      return existing;
    }

    // Also check by local entity to prevent duplicates
    const existingByLocal = await this.findByLocalEntity(
      options.integrationId,
      options.entityType,
      options.localEntityId,
    );
    if (existingByLocal) {
      return existingByLocal;
    }

    return this.createMapping(options);
  }

  private mapToExternalMapping(row: {
    id: string;
    integrationId: string;
    entityType: 'task' | 'project' | 'event' | 'activity' | 'initiative';
    localEntityId: string;
    externalId: string;
    syncDirection: 'inbound' | 'outbound' | 'bidirectional';
    lastSyncedFromExternal: Date | null;
    lastSyncedToExternal: Date | null;
    externalVersion: string | null;
    metadata: unknown;
    createdAt: Date;
    updatedAt: Date;
  }): ExternalMapping {
    return {
      id: row.id,
      integrationId: row.integrationId,
      entityType: row.entityType,
      localEntityId: row.localEntityId,
      externalId: row.externalId,
      syncDirection: row.syncDirection,
      lastSyncedFromExternal: row.lastSyncedFromExternal,
      lastSyncedToExternal: row.lastSyncedToExternal,
      externalVersion: row.externalVersion,
      metadata: row.metadata as Record<string, unknown> | null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

// Singleton instance
let mappingServiceInstance: MappingService | null = null;

/**
 * Get the shared mapping service instance.
 */
export function getMappingService(): MappingService {
  mappingServiceInstance ??= new MappingService();
  return mappingServiceInstance;
}
