/**
 * Common test fixtures and data builders for DTO testing.
 * Shared across legacy DTO tests to reduce duplication and file sizes.
 */

/** A canonical valid 26-char Crockford ULID, reused across DTO fixtures. */
export const ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
/** A second distinct valid ULID. */
export const ID2 = '01BX5ZZKBKACTAV9WEVGEMMVRZ';
/** A third distinct valid ULID. */
export const ID3 = '01BX5ZZKBKACTAV9WEVGEMMVS0';

/**
 * Minimal task data for use in tests.
 * Provides a baseline that can be spread/merged for variations.
 */
export const minimalTaskData = {
  id: ID,
  organizationId: ID2,
  title: 'T',
  teamId: ID,
  state: 'todo',
  priority: 'none',
  autoCompletedBySubtasks: false,
  assigneeId: null,
  delegateId: null,
  projectId: null,
  programId: null,
  startDate: null,
  dueDate: null,
  provenance: { source: 'native' },
  createdAt: 'x',
  updatedAt: 'x',
} as const;

/**
 * Minimal project data for use in tests.
 */
export const minimalProjectData = {
  id: ID,
  organizationId: ID2,
  name: 'P',
  status: 'started',
  priority: 'none',
  health: 'on_track',
  leadId: null,
  teamId: null,
  programId: null,
  startDate: null,
  startDateResolution: null,
  startDateFiscalYearStartMonth: null,
  targetDate: null,
  targetDateResolution: null,
  targetDateFiscalYearStartMonth: null,
  createdAt: 'x',
  updatedAt: 'x',
} as const;

/**
 * Minimal initiative data for use in tests.
 */
export const minimalInitiativeData = {
  id: ID,
  organizationId: ID2,
  name: 'I',
  summary: null,
  description: null,
  ownerId: null,
  status: 'active',
  priority: 'none',
  updateCadence: 'monthly',
  targetDate: null,
  targetDateResolution: null,
  targetDateFiscalYearStartMonth: null,
  health: null,
  createdAt: 'x',
} as const;

/**
 * Minimal cycle data for use in tests.
 */
export const minimalCycleData = {
  id: ID,
  organizationId: ID2,
  teamId: ID,
  number: 1,
  name: null,
  displayName: 'Jul 27 – Aug 2',
  startsAt: 'x',
  endsAt: 'y',
  status: 'active' as const,
  createdAt: 'z',
} as const;

/**
 * Minimal calendar event data.
 */
export const minimalCalendarEventData = {
  id: ID3,
  connectionId: ID,
  calendarId: ID2,
  externalCalendarId: 'primary',
  externalEventId: 'event-1',
  status: 'confirmed',
  title: 'Design review',
  description: null,
  location: null,
  htmlLink: null,
  startsAt: '2026-06-30T16:00:00.000Z',
  endsAt: '2026-06-30T17:00:00.000Z',
  allDayStartDate: null,
  allDayEndDate: null,
  organizer: null,
  attendees: [],
  updatedExternalAt: null,
  createdAt: '2026-06-30T15:01:00.000Z',
  updatedAt: '2026-06-30T15:01:00.000Z',
} as const;

/**
 * Helpers for building test data with common variations.
 */
export const builders = {
  /**
   * Create a calendar event with timed and all-day variants.
   */
  calendarEvent: {
    timed: (overrides = {}) => ({
      ...minimalCalendarEventData,
      ...overrides,
    }),
    allDay: (overrides = {}) => ({
      ...minimalCalendarEventData,
      startsAt: null,
      endsAt: null,
      allDayStartDate: '2026-06-30',
      allDayEndDate: '2026-07-01',
      ...overrides,
    }),
  },

  /**
   * Create a minimal task with common variations.
   */
  task: (overrides = {}) => ({
    ...minimalTaskData,
    labels: [],
    ...overrides,
  }),

  /**
   * Create a minimal project with all nullable fields resolved.
   */
  project: (overrides = {}) => ({
    ...minimalProjectData,
    description: null,
    ...overrides,
  }),

  /**
   * Create a minimal initiative.
   */
  initiative: (overrides = {}) => ({
    ...minimalInitiativeData,
    ...overrides,
  }),

  /**
   * Create a minimal cycle.
   */
  cycle: (overrides = {}) => ({
    ...minimalCycleData,
    ...overrides,
  }),
};
