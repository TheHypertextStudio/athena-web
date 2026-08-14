/** Portable work-location provider capabilities and adapter boundary. */
import type { WorkLocationProviderCapabilities, WorkLocationSchedule } from '@docket/types';

/** One provider-neutral assertion projection supplied to an adapter. */
export interface WorkLocationProviderAssertion {
  readonly assertionId: string;
  readonly revision: number;
  readonly placeId: string;
  readonly placeName: string;
  readonly homeDesignated: boolean;
  readonly classification: string | null;
  readonly providerPlaceId: string | null;
  readonly providerPlaceMetadata: Readonly<Record<string, string>>;
  readonly schedule: WorkLocationSchedule;
}

/** Result of mapping a canonical assertion into provider-native request data. */
export interface WorkLocationProviderProjection {
  readonly externalEventId: string | null;
  readonly body: Readonly<Record<string, unknown>>;
}

/** Contract implemented by every scheduled/current work-location provider. */
export interface WorkLocationProviderAdapter {
  readonly provider: string;
  readonly capabilities: WorkLocationProviderCapabilities;
  projectAssertion(assertion: WorkLocationProviderAssertion): WorkLocationProviderProjection;
}

/** Google Calendar supports scheduled location, change feeds, and writes, but not current presence. */
export const GOOGLE_WORK_LOCATION_CAPABILITIES: WorkLocationProviderCapabilities = {
  scheduledIntervals: true,
  partialDays: true,
  weeklyRecurrence: true,
  currentPresence: false,
  providerPlaceIds: true,
  inboundChanges: true,
  writes: true,
};

/** Microsoft Graph capability fixture for the future adapter boundary. */
export const MICROSOFT_WORK_LOCATION_CAPABILITIES: WorkLocationProviderCapabilities = {
  scheduledIntervals: true,
  partialDays: true,
  weeklyRecurrence: true,
  currentPresence: true,
  providerPlaceIds: true,
  inboundChanges: true,
  writes: true,
};
