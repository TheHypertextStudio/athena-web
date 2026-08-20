import { describe, expect, it } from 'vitest';

import {
  InitiativeCreate,
  InitiativeOut,
  InitiativeUpdate,
  ProjectCreate,
  ProjectOut,
  ProjectUpdate,
  WorkspaceSettingsOut,
  WorkspaceSettingsUpdate,
} from '../../src';

describe('planning timeframe DTOs', () => {
  it('accepts Linear resolution values on Project writes', () => {
    expect(
      ProjectCreate.parse({
        name: 'Launch Ada',
        startDate: '2026-06-01',
        startDateResolution: 'month',
        targetDate: '2026-06-30',
        targetDateResolution: 'month',
      }),
    ).toMatchObject({ startDateResolution: 'month', targetDateResolution: 'month' });
    expect(
      ProjectUpdate.parse({ targetDate: '2026-09-30', targetDateResolution: 'quarter' }),
    ).toEqual({ targetDate: '2026-09-30', targetDateResolution: 'quarter' });
  });

  it('keeps a date without resolution backward compatible as a precise day', () => {
    expect(
      ProjectCreate.parse({ name: 'Precise launch', targetDate: '2026-06-17' }),
    ).not.toHaveProperty('targetDateResolution');
  });

  it('accepts Linear target resolution values on Initiative writes', () => {
    expect(
      InitiativeCreate.parse({
        name: 'Market expansion',
        targetDate: '2027-06-30',
        targetDateResolution: 'year',
      }),
    ).toMatchObject({ targetDateResolution: 'year' });
    expect(InitiativeUpdate.parse({ targetDate: null, targetDateResolution: null })).toEqual({
      targetDate: null,
      targetDateResolution: null,
    });
  });

  it('returns read-only resolution and fiscal snapshot fields', () => {
    expect(ProjectOut.shape).toHaveProperty('startDateResolution');
    expect(ProjectOut.shape).toHaveProperty('startDateFiscalYearStartMonth');
    expect(ProjectOut.shape).toHaveProperty('targetDateResolution');
    expect(ProjectOut.shape).toHaveProperty('targetDateFiscalYearStartMonth');
    expect(InitiativeOut.shape).toHaveProperty('targetDateResolution');
    expect(InitiativeOut.shape).toHaveProperty('targetDateFiscalYearStartMonth');
  });

  it('accepts only zero-based workspace fiscal months', () => {
    expect(WorkspaceSettingsUpdate.parse({ fiscalYearStartMonth: 6 })).toEqual({
      fiscalYearStartMonth: 6,
    });
    expect(WorkspaceSettingsOut.shape).toHaveProperty('fiscalYearStartMonth');
    expect(WorkspaceSettingsUpdate.safeParse({ fiscalYearStartMonth: -1 }).success).toBe(false);
    expect(WorkspaceSettingsUpdate.safeParse({ fiscalYearStartMonth: 12 }).success).toBe(false);
    expect(WorkspaceSettingsUpdate.safeParse({ fiscalYearStartMonth: 1.5 }).success).toBe(false);
  });
});
