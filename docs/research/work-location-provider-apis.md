# Work Location Provider API Research

> **Date verified**: 2026-08-13
> **Implementation target**: Google Workspace V1; Microsoft Graph contract fixtures only

## Google Workspace Calendar

Google models work location as a Calendar status event on an eligible user's primary calendar.
Creation uses `eventType: workingLocation`, `workingLocationProperties`, `visibility: public`, and
`transparency: transparent`. The property type is one of `homeOffice`, `officeLocation`, or
`customLocation`; office values may include building, floor, section, desk, and label metadata.
The event type is immutable after creation.

Timed events and exactly one-day all-day events are supported. Recurring events use ordinary
Calendar recurrence rules. Listing with `singleEvents: false` preserves recurring masters and
exceptions; instances identify their master and original occurrence through `recurringEventId`
and `originalStartTime`. Docket's location sync therefore needs a provider-specific primary-
calendar cursor rather than the layered calendar's bounded expanded-instance pull.

The repository already requests `calendar.events` and `calendar.calendarlist.readonly`; no new
Calendar OAuth scope is required. Workspace Admin building discovery uses a separate Directory
scope and is deliberately excluded. Imported office identifiers are preserved without fetching
the tenant building catalog.

Primary references:

- <https://developers.google.com/workspace/calendar/api/guides/calendar-status>
- <https://developers.google.com/workspace/calendar/api/v3/reference/events>
- <https://developers.google.com/calendar/api/v3/reference/events/list>
- <https://developers.google.com/workspace/calendar/api/guides/recurringevents>
- <https://developers.google.com/workspace/calendar/api/auth>

## Microsoft Graph

Microsoft exposes scheduled hybrid-work data under
`/me/settings/workHoursAndLocations`: recurring work plans and bounded occurrences carry start,
end, provider place id, and `office | remote | timeOff` classification. A separate
`setCurrentLocation` action updates the current segment or current day and requires delegated
`Calendars.ReadWrite` for work/school accounts.

These shapes justify distinct provider capabilities for scheduled intervals, recurrence, office
ids, and current presence. They do not justify leaking `office` or `remote` into Docket's saved-
place model. A future adapter maps each arbitrary Docket place per account.

Primary references:

- <https://learn.microsoft.com/en-us/graph/api/resources/workhoursandlocationssetting?view=graph-rest-1.0>
- <https://learn.microsoft.com/en-us/graph/api/resources/workplanoccurrence?view=graph-rest-1.0>
- <https://learn.microsoft.com/en-us/graph/api/resources/workplanrecurrence?view=graph-rest-1.0>
- <https://learn.microsoft.com/en-us/graph/api/workplanoccurrence-setcurrentlocation?view=graph-rest-1.0>

## Foreground Web Location

The Geolocation API is permission-controlled and returns an accuracy radius. Docket watches only
while the document is visible, matches positions to saved-place geofences in the browser, and
uploads only a matched place id plus accuracy. A sample matches conservatively when
`distance + accuracy <= saved radius`.

Primary references:

- <https://www.w3.org/TR/geolocation/>
- <https://www.w3.org/TR/permissions/>
