import { describe, expect, it } from 'vitest';

import {
  ActorId,
  GrantId,
  InvitationId,
  OrganizationId,
  RoleId,
  TeamId,
} from '@docket/identity-access/ids';
import { AgentId, AgentSessionId, SessionActivityId } from '@docket/athena/ids';
import { AuditEventId, IntegrationId } from '@docket/connections/ids';
import {
  CommentId,
  CycleId,
  InitiativeId,
  LabelId,
  MilestoneId,
  ProgramId,
  ProjectId,
  SavedViewId,
  TaskId,
  UpdateId,
} from '@docket/work/ids';
import { DailyPlanItemId } from '@docket/planning/ids';
import { DateString } from '@docket/planning/date-time';
import { NotificationId } from '@docket/notifications/ids';

/** A canonical valid 26-char Crockford ULID. */
const VALID_ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

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
