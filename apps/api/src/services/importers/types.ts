/**
 * Shared types for data importers.
 *
 * @packageDocumentation
 */

/**
 * Normalized task structure from any import source.
 */
export interface ImportedTask {
  /** External ID from the source system */
  externalId?: string;

  /** Task title/name */
  title: string;

  /** Task description/notes */
  description?: string;

  /** Priority level */
  priority?: 'low' | 'medium' | 'high' | 'urgent';

  /** Due date/deadline */
  deadline?: Date;

  /** Task status */
  status?: 'pending' | 'in_progress' | 'completed' | 'cancelled';

  /** Tags/labels */
  tags?: string[];

  /** Estimated duration in minutes */
  estimatedMinutes?: number;

  /** Project name (for reference - will be mapped to project ID) */
  projectName?: string;

  /** Additional metadata from the source */
  metadata?: {
    source: string;
    parentId?: string;
    childOrder?: number;
    recurrence?: string;
    completedAt?: Date;
    addedAt?: Date;
    [key: string]: unknown;
  };
}

/**
 * Import result.
 */
export interface ImportResult {
  success: boolean;
  imported: number;
  skipped: number;
  errors: {
    index: number;
    message: string;
  }[];
  taskIds: string[];
}
