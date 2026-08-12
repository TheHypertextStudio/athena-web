/**
 * Seeding an entity's own row from the response that created it.
 *
 * @remarks
 * The create endpoint hands back the whole record and, before this, the client kept only the id
 * to put in a URL. The destination page then mounted against an empty cache and rendered a
 * skeleton for something it had just been given. These tests pin the two properties that make
 * the seed worth having and safe to keep: the page reads the exact key the seed writes, and that
 * key sits under the collection every create already invalidates, so a partial seed is corrected
 * by a refetch rather than left standing.
 */
import type { InitiativeOut, ProgramOut, ProjectOut, TaskOut } from '@docket/types';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import {
  initiativeRecordDef,
  programRecordDef,
  projectRecordDef,
  seedInitiativeRecord,
  seedProgramRecord,
  seedProjectRecord,
  seedTaskRecord,
} from '../../src/lib/entity-records';
import { queryKeys } from '../../src/lib/query-keys';

const ORG = 'org_1';

/** A `ProjectOut` with only the fields these tests read. */
const PROJECT = { id: 'project_1', name: 'Rewrite onboarding' } as unknown as ProjectOut;
const PROGRAM = { id: 'program_1', name: 'Platform' } as unknown as ProgramOut;
const INITIATIVE = { id: 'initiative_1', name: 'Reduce churn' } as unknown as InitiativeOut;
const TASK = { id: 'task_1', title: 'Draft the brief' } as unknown as TaskOut;

/** Does `key` sit under `prefix`, the way TanStack matches an invalidation? */
function isUnder(key: readonly unknown[], prefix: readonly unknown[]): boolean {
  return prefix.every((segment, index) => key[index] === segment);
}

describe('seeding a created record', () => {
  it('writes the project where its detail page reads', () => {
    const client = new QueryClient();

    seedProjectRecord(client, ORG, PROJECT);

    expect(client.getQueryData(projectRecordDef(ORG, PROJECT.id).queryKey)).toEqual(PROJECT);
  });

  it('writes the task where its detail page reads, carrying the associations it just chose', () => {
    const client = new QueryClient();

    seedTaskRecord(client, ORG, TASK, { milestoneId: 'milestone_1', cycleId: null });

    // The create response is a `TaskOut`, which does not echo these back. Leaving them out would
    // render a task that has a milestone as though it had none until the refetch landed.
    expect(client.getQueryData(queryKeys.task(ORG, TASK.id))).toMatchObject({
      id: TASK.id,
      milestoneId: 'milestone_1',
      cycleId: null,
    });
  });

  it('gives a new program an empty roll-up rather than none at all', () => {
    const client = new QueryClient();

    seedProgramRecord(client, ORG, PROGRAM);

    // The endpoint answers a row plus its child-work counts, and nothing can hang off a program
    // this new — so zero is the true answer here, not a placeholder standing in for one.
    expect(client.getQueryData(programRecordDef(ORG, PROGRAM.id).queryKey)).toMatchObject({
      id: PROGRAM.id,
      rollup: { projects: 0, tasks: 0 },
    });
  });

  it('gives a new initiative an empty roll-up and no derived health', () => {
    const client = new QueryClient();

    seedInitiativeRecord(client, ORG, INITIATIVE);

    expect(client.getQueryData(initiativeRecordDef(ORG, INITIATIVE.id).queryKey)).toMatchObject({
      id: INITIATIVE.id,
      childMix: { programs: 0, projects: 0 },
      distribution: { onTrack: 0, atRisk: 0, offTrack: 0, unknown: 0 },
      rolledUpHealth: null,
    });
  });
});

describe('record keys', () => {
  it('sit under the collection key every create already invalidates', () => {
    // This is what makes a seed safe to be incomplete: the create's existing invalidation reaches
    // the record by prefix, so the entry is stale the moment it is written and the page's own
    // refetch trues it up. Break the nesting and a partial seed becomes a stale one.
    expect(isUnder(projectRecordDef(ORG, 'p1').queryKey, queryKeys.projects(ORG))).toBe(true);
    expect(isUnder(programRecordDef(ORG, 'g1').queryKey, queryKeys.programs(ORG))).toBe(true);
    expect(isUnder(initiativeRecordDef(ORG, 'i1').queryKey, queryKeys.initiatives(ORG))).toBe(true);
    expect(isUnder(queryKeys.task(ORG, 't1'), queryKeys.tasks(ORG))).toBe(true);
  });

  it('sit under the composite detail key, so a detail invalidation refreshes both halves', () => {
    expect(isUnder(projectRecordDef(ORG, 'p1').queryKey, queryKeys.project(ORG, 'p1'))).toBe(true);
    expect(isUnder(programRecordDef(ORG, 'g1').queryKey, queryKeys.program(ORG, 'g1'))).toBe(true);
    expect(isUnder(initiativeRecordDef(ORG, 'i1').queryKey, queryKeys.initiative(ORG, 'i1'))).toBe(
      true,
    );
  });

  it('does not collide with the composite key it sits beneath', () => {
    // Same prefix, different entry: the row and the dozen-request composite have to cache apart,
    // or seeding the row would overwrite the payload the tab panels read.
    expect(projectRecordDef(ORG, 'p1').queryKey).not.toEqual(queryKeys.project(ORG, 'p1'));
  });
});
