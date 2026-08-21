/** Storage shape for typed planning lists, saved definitions, and shared manual ordering. */
import { getTableColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import {
  initiative,
  organizationWorkViewDefault,
  project,
  projectMember,
  projectTeam,
  savedView,
  workItemOrder,
} from '../../src/schema';

describe('typed planning-list storage', () => {
  it('closes the Project and Initiative property gaps', () => {
    const projectColumns = getTableColumns(project);
    const initiativeColumns = getTableColumns(initiative);

    expect(projectColumns.priority.notNull).toBe(true);
    expect(projectColumns.priority.default).toBeDefined();
    expect(initiativeColumns.leadTeamId).toBeDefined();
  });

  it('stores Project teams separately from members', () => {
    expect(Object.keys(getTableColumns(projectTeam))).toEqual([
      'projectId',
      'teamId',
      'organizationId',
      'isPrimary',
    ]);
    expect(Object.keys(getTableColumns(projectMember))).toEqual([
      'projectId',
      'actorId',
      'organizationId',
    ]);

    const projectTeamConfig = getTableConfig(projectTeam);
    expect(projectTeamConfig.primaryKeys).toHaveLength(1);
    expect(projectTeamConfig.indexes.map((index) => index.config.name)).toContain(
      'project_team_one_primary_uq',
    );
  });

  it('stores one rank per item and ordering context', () => {
    expect(Object.keys(getTableColumns(workItemOrder))).toEqual([
      'organizationId',
      'contextType',
      'contextId',
      'target',
      'itemId',
      'rank',
      'updatedAt',
    ]);
    expect(getTableConfig(workItemOrder).primaryKeys).toHaveLength(1);
  });

  it('adds v2 state without removing the compatibility fields', () => {
    const columns = getTableColumns(savedView);

    expect(columns).toHaveProperty('target');
    expect(columns).toHaveProperty('context');
    expect(columns).toHaveProperty('position');
    expect(columns).toHaveProperty('schemaVersion');
    expect(columns).toHaveProperty('definition');
    expect(columns).toHaveProperty('filters');
    expect(columns).toHaveProperty('grouping');
    expect(columns).toHaveProperty('sort');
  });

  it('stores one workspace default per planning level', () => {
    const config = getTableConfig(organizationWorkViewDefault);

    expect(Object.keys(getTableColumns(organizationWorkViewDefault))).toEqual([
      'organizationId',
      'target',
      'definition',
      'updatedBy',
      'updatedAt',
    ]);
    expect(config.primaryKeys).toHaveLength(1);
  });
});
