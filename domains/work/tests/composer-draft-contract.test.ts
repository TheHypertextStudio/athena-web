import { describe, expect, it } from 'vitest';

import {
  COMPOSER_DRAFT_TTL_DAYS,
  ComposerDraftCreate,
  ComposerDraftListQuery,
  ComposerDraftPatch,
  ComposerDraftPayload,
  composerDraftTitle,
} from '../src/contracts/composer-draft';

const ORG = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const ACTOR = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const TEAM = '01ARZ3NDEKTSV4RRFFQ69G5FAX';
const PROJECT = '01ARZ3NDEKTSV4RRFFQ69G5FAY';
const LABEL = '01ARZ3NDEKTSV4RRFFQ69G5FAZ';

const PAYLOADS = {
  task: {
    kind: 'task',
    title: 'Segment donors',
    description: 'By region.',
    teamOverride: TEAM,
    state: 'todo',
    priority: 'high',
    assigneeId: ACTOR,
    projectId: PROJECT,
    milestoneId: null,
    cycleId: null,
    startDate: '2026-09-18',
    dueDate: '2026-09-25',
    labelIds: [LABEL],
    estimate: 3,
    repeat: {
      kind: 'calendar',
      schedule: {
        kind: 'weekly',
        interval: 1,
        startDate: '2026-09-18',
        timezone: 'UTC',
        end: { kind: 'never' },
        weekdays: ['monday'],
      },
      missedPolicy: 'skip',
      materialization: { horizonDays: 28, minimumOccurrences: 2 },
    },
  },
  project: {
    kind: 'project',
    name: 'Outreach',
    summary: 'Reach every lapsed donor.',
    description: '## Goal',
    teamOverride: null,
    leadId: ACTOR,
    programId: null,
    status: 'planned',
    health: 'on_track',
    startTimeframe: { date: '2026-10-01', resolution: 'quarter', fiscalYearStartMonth: 0 },
    targetTimeframe: null,
    initiativeIds: [],
    milestones: [{ name: 'Kickoff', targetDate: '2026-10-03', description: '' }],
  },
  initiative: {
    kind: 'initiative',
    name: 'Spring giving',
    summary: '',
    description: '',
    ownerId: null,
    status: 'active',
    targetTimeframe: null,
    health: null,
    priority: 'medium',
    updateCadence: 'weekly',
  },
  program: {
    kind: 'program',
    name: 'Volunteer ops',
    summary: '',
    description: '',
    ownerId: ACTOR,
    status: 'active',
    health: 'at_risk',
    visibility: 'private',
  },
  team: {
    kind: 'team',
    name: 'Field',
    key: 'FLD',
    summary: '',
    description: '',
    triageEnabled: true,
    agentGuidance: 'Prefer short tasks.',
  },
} as const;

describe('ComposerDraftPayload', () => {
  it.each(Object.entries(PAYLOADS))('round-trips a %s draft', (_kind, payload) => {
    expect(ComposerDraftPayload.parse(payload)).toEqual(payload);
  });

  it('accepts a payload with only its kind, since every field is optional', () => {
    for (const kind of Object.keys(PAYLOADS)) {
      expect(ComposerDraftPayload.parse({ kind })).toEqual({ kind });
    }
  });

  it('rejects a kind outside the five composers', () => {
    expect(ComposerDraftPayload.safeParse({ kind: 'cycle' }).success).toBe(false);
  });

  it('keeps the repeat schedule open beyond its kind and rejects an unknown cadence', () => {
    const open = ComposerDraftPayload.parse({
      kind: 'task',
      repeat: { kind: 'after_completion', schedule: { kind: 'after_completion', interval: 2 } },
    });
    expect(open).toMatchObject({ repeat: { schedule: { interval: 2 } } });
    const bad = ComposerDraftPayload.safeParse({
      kind: 'task',
      repeat: {
        kind: 'calendar',
        schedule: { kind: 'hourly' },
        missedPolicy: 'skip',
        materialization: { horizonDays: 1, minimumOccurrences: 1 },
      },
    });
    expect(bad.success).toBe(false);
  });

  it('caps project milestones at fifty rows', () => {
    const rows = Array.from({ length: 51 }, () => ({
      name: 'x',
      targetDate: null,
      description: '',
    }));
    expect(
      ComposerDraftPayload.safeParse({ kind: 'project', milestones: rows.slice(0, 50) }).success,
    ).toBe(true);
    expect(ComposerDraftPayload.safeParse({ kind: 'project', milestones: rows }).success).toBe(
      false,
    );
  });
});

describe('ComposerDraftCreate', () => {
  it('requires the payload to describe the same composer as kind', () => {
    const result = ComposerDraftCreate.safeParse({
      organizationId: ORG,
      kind: 'task',
      payload: { kind: 'project', name: 'Nope' },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain('payload.kind');
  });

  it('accepts a matching kind and payload', () => {
    const result = ComposerDraftCreate.safeParse({
      organizationId: ORG,
      kind: 'team',
      payload: PAYLOADS.team,
    });
    expect(result.success).toBe(true);
  });
});

describe('ComposerDraftPatch and ComposerDraftListQuery', () => {
  it('requires a non-negative integer revision', () => {
    expect(ComposerDraftPatch.safeParse({ revision: -1, payload: { kind: 'team' } }).success).toBe(
      false,
    );
    expect(ComposerDraftPatch.safeParse({ revision: 0, payload: { kind: 'team' } }).success).toBe(
      true,
    );
  });

  it('accepts either filter on its own or none at all', () => {
    expect(ComposerDraftListQuery.parse({})).toEqual({});
    expect(ComposerDraftListQuery.parse({ kind: 'task' })).toEqual({ kind: 'task' });
    expect(ComposerDraftListQuery.parse({ organizationId: ORG })).toEqual({ organizationId: ORG });
    expect(ComposerDraftListQuery.safeParse({ kind: 'cycle' }).success).toBe(false);
  });
});

describe('composerDraftTitle', () => {
  it('trims the task title', () => {
    expect(composerDraftTitle({ kind: 'task', title: '  Segment donors  ' })).toBe(
      'Segment donors',
    );
  });

  it('uses name for every other composer', () => {
    expect(composerDraftTitle({ kind: 'project', name: 'Outreach ' })).toBe('Outreach');
    expect(composerDraftTitle({ kind: 'initiative', name: 'Spring' })).toBe('Spring');
    expect(composerDraftTitle({ kind: 'program', name: 'Ops' })).toBe('Ops');
    expect(composerDraftTitle({ kind: 'team', name: 'Field' })).toBe('Field');
  });

  it('is null for a blank or missing title', () => {
    expect(composerDraftTitle({ kind: 'task' })).toBeNull();
    expect(composerDraftTitle({ kind: 'task', title: '   ' })).toBeNull();
    expect(composerDraftTitle({ kind: 'team', name: '' })).toBeNull();
  });
});

describe('COMPOSER_DRAFT_TTL_DAYS', () => {
  it('is half a year', () => {
    expect(COMPOSER_DRAFT_TTL_DAYS).toBe(183);
  });
});
