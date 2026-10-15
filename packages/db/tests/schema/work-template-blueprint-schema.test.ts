import { getTableColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import {
  initiative,
  milestone,
  organization,
  program,
  project,
  task,
  template,
} from '../../src/schema';

const work = { initiative, program, project, task, milestone };

describe('persisted blueprint origin and independent date ownership', () => {
  it.each(Object.entries(work))(
    'stores paired origin and independent bindings on %s',
    (_kind, table) => {
      expect(Object.keys(getTableColumns(table))).toEqual(
        expect.arrayContaining([
          'blueprintStepId',
          'blueprintSourceVersionId',
          'blueprintParentKind',
          'blueprintParentId',
          'blueprintPath',
          'blueprintDateBindings',
          'blueprintState',
          'blueprintEverStarted',
        ]),
      );
    },
  );

  it('stores working weekdays with the workspace', () => {
    expect(Object.keys(getTableColumns(organization))).toContain('workingWeekdays');
  });

  it('preserves copy origins across workspaces without a local tenant foreign key', () => {
    const columns = getTableColumns(template);
    expect(Object.keys(columns)).toEqual(
      expect.arrayContaining(['originWorkTypeId', 'originWorkTypeVersionId']),
    );
    const references = getTableConfig(template).foreignKeys.flatMap((key) =>
      key.reference().columns.map((column) => column.name),
    );
    expect(references).not.toContain('origin_work_type_id');
    expect(references).not.toContain('origin_work_type_version_id');
  });
});
