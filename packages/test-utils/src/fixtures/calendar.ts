/**
 * Test fixtures for calendar sync functionality.
 *
 * @packageDocumentation
 */

import { faker } from '@faker-js/faker';
import type {
  CalendarProvider,
  SyncedCalendar,
  ExternalCalendarEvent,
  EventAttendee,
  OAuthTokens,
} from '../mocks/calendar.js';

// =============================================================================
// Additional Types for Fixtures
// =============================================================================

export interface CalendarConnection {
  id: string;
  userId: string;
  provider: CalendarProvider;
  externalAccountId: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  syncEnabled: boolean;
  lastSyncAt?: Date;
  lastSyncStatus?: 'success' | 'error';
  lastSyncError?: string;
  calendars: SyncedCalendar[];
  accountLabel?: string;
  accountEmail?: string;
  accountColor?: string;
  isPrimary: boolean;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SyncResult {
  success: boolean;
  eventsCreated: number;
  eventsUpdated: number;
  eventsDeleted: number;
  errors: SyncError[];
  syncedAt: Date;
  nextSyncToken?: string;
}

export interface SyncError {
  eventId?: string;
  operation: 'create' | 'update' | 'delete';
  error: string;
}

// =============================================================================
// Helper function for generating colors
// =============================================================================

function generateHexColor(): string {
  return '#' + faker.string.hexadecimal({ length: 6, casing: 'lower' }).slice(2);
}

// =============================================================================
// Fixture Factory Functions
// =============================================================================

/**
 * Create a mock SyncedCalendar fixture.
 */
export function createSyncedCalendarFixture(
  overrides: Partial<SyncedCalendar> = {},
): SyncedCalendar {
  const id = faker.string.uuid();
  return {
    id,
    externalId: `external-${id}`,
    name: faker.helpers.arrayElement(['Work', 'Personal', 'Family', 'Holidays', 'Meetings']),
    color: generateHexColor(),
    isPrimary: false,
    canEdit: true,
    syncEnabled: true,
    syncDirection: 'bidirectional',
    ...overrides,
  };
}

/**
 * Create a mock CalendarConnection fixture.
 */
export function createCalendarConnectionFixture(
  overrides: Partial<CalendarConnection> = {},
): CalendarConnection {
  const now = new Date();
  const provider = overrides.provider ?? 'google';

  return {
    id: faker.string.uuid(),
    userId: faker.string.uuid(),
    provider,
    externalAccountId: faker.string.uuid(),
    accessToken: `mock-access-token-${faker.string.alphanumeric(20)}`,
    refreshToken: `mock-refresh-token-${faker.string.alphanumeric(20)}`,
    tokenExpiresAt: new Date(Date.now() + 3600000),
    syncEnabled: true,
    lastSyncAt: new Date(Date.now() - 300000), // 5 minutes ago
    lastSyncStatus: 'success',
    lastSyncError: undefined,
    calendars: [
      createSyncedCalendarFixture({ isPrimary: true, name: 'Primary' }),
      createSyncedCalendarFixture({ name: 'Work' }),
    ],
    accountLabel: faker.helpers.arrayElement(['Work', 'Personal', undefined]),
    accountEmail: faker.internet.email(),
    accountColor: generateHexColor(),
    isPrimary: true,
    displayOrder: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * Create a mock EventAttendee fixture.
 */
export function createEventAttendeeFixture(overrides: Partial<EventAttendee> = {}): EventAttendee {
  return {
    email: faker.internet.email(),
    name: faker.person.fullName(),
    status: faker.helpers.arrayElement(['pending', 'accepted', 'declined', 'tentative']),
    isOrganizer: false,
    ...overrides,
  };
}

/**
 * Create a mock ExternalCalendarEvent fixture.
 */
export function createExternalCalendarEventFixture(
  overrides: Partial<ExternalCalendarEvent> = {},
): ExternalCalendarEvent {
  const startTime = overrides.startTime ?? faker.date.future();
  const durationMinutes = faker.number.int({ min: 30, max: 180 });
  const endTime = overrides.endTime ?? new Date(startTime.getTime() + durationMinutes * 60000);

  return {
    externalId: faker.string.uuid(),
    calendarId: faker.string.uuid(),
    title: faker.lorem.sentence({ min: 3, max: 8 }),
    description: faker.lorem.paragraph(),
    startTime,
    endTime,
    isAllDay: false,
    location: faker.location.streetAddress(),
    recurrenceRule: undefined,
    attendees: undefined,
    status: 'confirmed',
    visibility: 'public',
    etag: `"${faker.string.alphanumeric(16)}"`,
    iCalUID: `${faker.string.uuid()}@calendar.example.com`,
    ...overrides,
  };
}

/**
 * Create an all-day event fixture.
 */
export function createAllDayEventFixture(
  overrides: Partial<ExternalCalendarEvent> = {},
): ExternalCalendarEvent {
  const startDate = faker.date.future();
  startDate.setHours(0, 0, 0, 0);

  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 1);

  return createExternalCalendarEventFixture({
    isAllDay: true,
    startTime: startDate,
    endTime: endDate,
    ...overrides,
  });
}

/**
 * Create a recurring event fixture.
 */
export function createRecurringEventFixture(
  overrides: Partial<ExternalCalendarEvent> = {},
): ExternalCalendarEvent {
  const recurrenceRule = faker.helpers.arrayElement([
    'RRULE:FREQ=DAILY;COUNT=10',
    'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR',
    'RRULE:FREQ=MONTHLY;BYMONTHDAY=1',
    'RRULE:FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=1',
  ]);

  return createExternalCalendarEventFixture({
    recurrenceRule,
    ...overrides,
  });
}

/**
 * Create an event with attendees fixture.
 */
export function createEventWithAttendeesFixture(
  attendeeCount = 3,
  overrides: Partial<ExternalCalendarEvent> = {},
): ExternalCalendarEvent {
  const organizer = createEventAttendeeFixture({ isOrganizer: true, status: 'accepted' });
  const attendees = [
    organizer,
    ...Array.from({ length: attendeeCount - 1 }, () => createEventAttendeeFixture()),
  ];

  return createExternalCalendarEventFixture({
    attendees,
    ...overrides,
  });
}

/**
 * Create a cancelled event fixture.
 */
export function createCancelledEventFixture(
  overrides: Partial<ExternalCalendarEvent> = {},
): ExternalCalendarEvent {
  return createExternalCalendarEventFixture({
    status: 'cancelled',
    ...overrides,
  });
}

/**
 * Create a mock SyncError fixture.
 */
export function createSyncErrorFixture(overrides: Partial<SyncError> = {}): SyncError {
  return {
    eventId: faker.string.uuid(),
    operation: faker.helpers.arrayElement(['create', 'update', 'delete']),
    error: faker.lorem.sentence(),
    ...overrides,
  };
}

/**
 * Create a mock SyncResult fixture.
 */
export function createSyncResultFixture(overrides: Partial<SyncResult> = {}): SyncResult {
  return {
    success: true,
    eventsCreated: faker.number.int({ min: 0, max: 10 }),
    eventsUpdated: faker.number.int({ min: 0, max: 5 }),
    eventsDeleted: faker.number.int({ min: 0, max: 3 }),
    errors: [],
    syncedAt: new Date(),
    nextSyncToken: `sync-token-${faker.string.alphanumeric(20)}`,
    ...overrides,
  };
}

/**
 * Create a failed sync result fixture.
 */
export function createFailedSyncResultFixture(
  errorCount = 1,
  overrides: Partial<SyncResult> = {},
): SyncResult {
  return createSyncResultFixture({
    success: false,
    errors: Array.from({ length: errorCount }, () => createSyncErrorFixture()),
    ...overrides,
  });
}

/**
 * Create a mock OAuthTokens fixture.
 */
export function createOAuthTokensFixture(overrides: Partial<OAuthTokens> = {}): OAuthTokens {
  return {
    accessToken: `access-${faker.string.alphanumeric(40)}`,
    refreshToken: `refresh-${faker.string.alphanumeric(40)}`,
    expiresAt: new Date(Date.now() + 3600000),
    tokenType: 'Bearer',
    scope: 'https://www.googleapis.com/auth/calendar',
    ...overrides,
  };
}

/**
 * Create expired OAuth tokens fixture.
 */
export function createExpiredOAuthTokensFixture(overrides: Partial<OAuthTokens> = {}): OAuthTokens {
  return createOAuthTokensFixture({
    expiresAt: new Date(Date.now() - 3600000), // Expired 1 hour ago
    ...overrides,
  });
}

/**
 * Create a set of calendars for a typical user setup.
 */
export function createTypicalCalendarSetup(): {
  calendars: SyncedCalendar[];
  events: ExternalCalendarEvent[];
} {
  const primaryCalendar = createSyncedCalendarFixture({
    id: 'primary',
    externalId: 'primary@gmail.com',
    name: 'Primary',
    isPrimary: true,
    syncDirection: 'bidirectional',
  });

  const workCalendar = createSyncedCalendarFixture({
    id: 'work',
    externalId: 'work@company.com',
    name: 'Work',
    color: '#1a73e8',
    syncDirection: 'bidirectional',
  });

  const readOnlyCalendar = createSyncedCalendarFixture({
    id: 'holidays',
    externalId: 'holidays@group.calendar.google.com',
    name: 'US Holidays',
    canEdit: false,
    syncDirection: 'pull',
  });

  const calendars = [primaryCalendar, workCalendar, readOnlyCalendar];

  // Create some events for each calendar
  const events: ExternalCalendarEvent[] = [
    // Primary calendar events
    createExternalCalendarEventFixture({
      calendarId: primaryCalendar.externalId,
      title: 'Doctor Appointment',
    }),
    createExternalCalendarEventFixture({
      calendarId: primaryCalendar.externalId,
      title: 'Dinner with Friends',
    }),
    // Work calendar events
    createExternalCalendarEventFixture({
      calendarId: workCalendar.externalId,
      title: 'Team Standup',
    }),
    createRecurringEventFixture({
      calendarId: workCalendar.externalId,
      title: 'Weekly 1:1',
      recurrenceRule: 'RRULE:FREQ=WEEKLY;BYDAY=TU',
    }),
    createEventWithAttendeesFixture(5, {
      calendarId: workCalendar.externalId,
      title: 'Project Kickoff',
    }),
    // Holiday calendar events
    createAllDayEventFixture({
      calendarId: readOnlyCalendar.externalId,
      title: 'Independence Day',
    }),
  ];

  return { calendars, events };
}

/**
 * Create multiple calendar connections for different providers.
 */
export function createMultiProviderSetup(): CalendarConnection[] {
  return [
    createCalendarConnectionFixture({
      provider: 'google',
      accountLabel: 'Personal Gmail',
      isPrimary: true,
      displayOrder: 0,
    }),
    createCalendarConnectionFixture({
      provider: 'google',
      accountLabel: 'Work Gmail',
      isPrimary: false,
      displayOrder: 1,
    }),
    createCalendarConnectionFixture({
      provider: 'outlook',
      accountLabel: 'Office 365',
      isPrimary: true,
      displayOrder: 2,
    }),
    createCalendarConnectionFixture({
      provider: 'caldav',
      accountLabel: 'Fastmail',
      isPrimary: true,
      displayOrder: 3,
      // CalDAV doesn't use OAuth
      accessToken: undefined,
      refreshToken: undefined,
      tokenExpiresAt: undefined,
    }),
  ];
}

/**
 * Create a scenario for testing conflict detection.
 */
export function createConflictScenario(): {
  localEvent: ExternalCalendarEvent;
  externalEvent: ExternalCalendarEvent;
  staleMapping: { externalVersion: string };
} {
  const eventId = faker.string.uuid();
  const calendarId = 'primary@gmail.com';

  const localEvent = createExternalCalendarEventFixture({
    externalId: eventId,
    calendarId,
    title: 'Meeting (local edit)',
    etag: '"old-etag-123"',
  });

  const externalEvent = createExternalCalendarEventFixture({
    externalId: eventId,
    calendarId,
    title: 'Meeting (external edit)',
    etag: '"new-etag-456"',
  });

  const staleMapping = {
    externalVersion: '"old-etag-123"',
  };

  return { localEvent, externalEvent, staleMapping };
}
