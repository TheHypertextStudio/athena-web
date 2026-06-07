import { describe, expect, it } from 'vitest';

import {
  ActorId,
  AgentId,
  AgentSessionId,
  AuditEventId,
  CommentId,
  CycleId,
  DailyPlanItemId,
  DateString,
  GrantId,
  Id,
  InitiativeId,
  IntegrationId,
  InvitationId,
  LabelId,
  MilestoneId,
  NotificationId,
  OrganizationId,
  ProgramId,
  ProjectId,
  RoleId,
  SavedViewId,
  SessionActivityId,
  TaskId,
  TeamId,
  ULID_REGEX,
  UpdateId,
} from '../src/primitives';

/** A canonical valid 26-char Crockford ULID. */
const VALID_ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

describe('ULID_REGEX', () => {
  it('matches a 26-char Crockford ULID', () => {
    expect(ULID_REGEX.test(VALID_ULID)).toBe(true);
  });

  it('rejects forbidden Crockford letters (I, L, O, U)', () => {
    expect(ULID_REGEX.test('01ARZ3NDEKTSV4RRFFQ69G5FAI')).toBe(false);
    expect(ULID_REGEX.test('01ARZ3NDEKTSV4RRFFQ69G5FAL')).toBe(false);
    expect(ULID_REGEX.test('01ARZ3NDEKTSV4RRFFQ69G5FAO')).toBe(false);
    expect(ULID_REGEX.test('01ARZ3NDEKTSV4RRFFQ69G5FAU')).toBe(false);
  });

  it('rejects wrong-length strings', () => {
    expect(ULID_REGEX.test('TOOSHORT')).toBe(false);
    expect(ULID_REGEX.test(`${VALID_ULID}EXTRA`)).toBe(false);
  });
});

describe('Id', () => {
  it('parses a valid ULID', () => {
    expect(Id.parse(VALID_ULID)).toBe(VALID_ULID);
  });

  it('rejects a non-ULID', () => {
    expect(Id.safeParse('not-a-ulid').success).toBe(false);
  });
});

describe('branded ids', () => {
  const branded = [
    OrganizationId,
    ActorId,
    TeamId,
    RoleId,
    GrantId,
    InvitationId,
    InitiativeId,
    ProgramId,
    ProjectId,
    MilestoneId,
    CycleId,
    TaskId,
    LabelId,
    CommentId,
    UpdateId,
    SavedViewId,
    AgentId,
    AgentSessionId,
    SessionActivityId,
    IntegrationId,
    NotificationId,
    DailyPlanItemId,
    AuditEventId,
  ];

  it('every branded id accepts a valid ULID and rejects an invalid one', () => {
    for (const schema of branded) {
      expect(schema.parse(VALID_ULID)).toBe(VALID_ULID);
      expect(schema.safeParse('nope').success).toBe(false);
    }
  });

  it('all share the single ULID runtime validator (same regex)', () => {
    for (const schema of branded) {
      expect(schema.safeParse('01ARZ3NDEKTSV4RRFFQ69G5FAI').success).toBe(false);
    }
  });
});

describe('DateString', () => {
  it('accepts an ISO date', () => {
    expect(DateString.parse('2026-06-05')).toBe('2026-06-05');
  });

  it('rejects a non-date string', () => {
    expect(DateString.safeParse('06/05/2026').success).toBe(false);
  });
});
