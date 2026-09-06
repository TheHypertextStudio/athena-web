# Canonical Calendar Sources And Events

> **Status**: Approved
> **Date**: 2026-09-05
> **Audience**: Docket maintainers implementing calendar sync, settings, and read surfaces
> **Required action**: Implement the provider-neutral identity and source-management contract in this document

## Decision

Docket will show one logical calendar and one logical event when several connected accounts expose
the same provider object. Docket will prove identity from provider-issued keys. It will not infer
identity from an event title and time.

Calendar, Agenda, Today, and item details will not mention extra copies or source deduplication.
Google Calendar settings will show one logical calendar row with a compact source count. A person
may expand that row to inspect accounts, choose the preferred source, or remove an upstream
subscription. A provider adapter will supply identity and management capabilities, so a future
Microsoft Outlook adapter can implement the same product contract without Google branches in the
shared calendar model.

Exact provider identity collapses automatically. A likely match, such as two holiday calendars with
different provider identities, stays separate until the person confirms **Combine these calendars?**
The person can separate that group later.

## Product Contract

The main calendar surfaces show the canonical event from the preferred source. They merge Docket
task links and item relationships from equivalent source events into that canonical item. They do
not show a copy count, stacked-source icon, “Also on,” or deduplication text.

Google Calendar settings shows one row per logical calendar. A row with several active sources shows
a stacked-source icon and text such as **2 accounts**. Expanding it shows each connected account,
the preferred source, a **Use as preferred** action, and provider-supported source management.
Turning the logical calendar off disables all of its active sources in one server transaction.

Settings may suggest a likely group. It must leave the rows separate until a person confirms the
group and its preferred source. Settings will use neutral copy such as **Combine these calendars?**
It will not call either source a duplicate.

## Identity Contract

Provider adapters emit opaque identity values. Shared code compares the namespace and value without
normalizing provider data itself.

```ts
interface ProviderIdentity {
  namespace: string;
  value: string;
}

interface ProviderLayerSnapshot {
  sourceIdentity: ProviderIdentity;
  sourceRelationship: 'owned' | 'direct' | 'shared' | 'subscribed';
  sourceManagement: {
    canRemoveSubscription: boolean;
    requiresIncrementalConsent: boolean;
  };
  suggestedGroupKey: string | null;
}

interface ProviderItemSnapshot {
  eventIdentity: ProviderIdentity;
  occurrenceIdentity: string | null;
}
```

The Google adapter uses a normalized Google calendar id for `sourceIdentity`. It uses `iCalUID` for
`eventIdentity`. A recurring occurrence adds the provider's `originalStartTime` value as
`occurrenceIdentity` because Google uses one `iCalUID` for the whole recurring series. If Google
omits `iCalUID`, the adapter emits a provider-local event identity that includes the source identity
and external event id. That fallback cannot collapse events across calendars.

A future Microsoft adapter will use the Microsoft Graph calendar id for `sourceIdentity`, `iCalUId`
for `eventIdentity`, and `originalStart` for `occurrenceIdentity`. It must request immutable Graph
ids so a move does not silently change an item's durable provider anchor. The shared model will not
need a Microsoft-specific field or branch.

## Canonical Selection

Docket selects one active source for a logical calendar in this order:

1. A stored preferred source that still exists and remains active.
2. An owned or directly added source.
3. The provider's primary source.
4. The stable lowest Docket layer id.

Docket selects one occurrence from equivalent event copies in this order:

1. The occurrence on the logical calendar's preferred source.
2. An occurrence that the person can edit.
3. An occurrence on a primary source.
4. The stable lowest Docket item id.

The read service unions task links and item relationships from every equivalent occurrence. It
returns the preferred occurrence's provider permissions, provider link, and source metadata. A
write targets that preferred occurrence. A person can change the preferred source in settings
before editing an event when another copy should own provider writes.

## Persistence

`calendar_layer` stores the source identity namespace and value, source relationship, management
capabilities, a suggested-group key, and `removed_at`. `calendar_item` stores the event identity
namespace and value plus the occurrence identity.

Two tables store confirmed logical-calendar groups:

- `calendar_source_group` owns the user, preferred layer, and timestamps.
- `calendar_source_group_member` assigns each layer to at most one confirmed group.

An exact source-identity group does not require a stored group row. Docket derives it from active
layers. Docket creates a group row when the person confirms a suggested group or chooses a
preference that the derived order cannot represent.

Provider cleanup soft-removes local rows. It sets `removed_at`, clears watch state, and excludes the
source from settings and reads. It does not delete the layer, events, task links, item relationships,
shares, or write history. A later provider list sync revives the same row when the source returns.

Existing Google event payloads in `provider_raw` contain the data needed to backfill `iCalUID` and
`originalStartTime`. Rows without usable provider identity receive the source-local fallback. The
migration never guesses from title, time, attendees, or description.

## Read And Sync Boundaries

The API canonicalizes calendar items before it returns them. Clients must not repeat identity logic
or use title-and-time heuristics. The compatibility Agenda route will call the canonical read
service until all consumers use the layered calendar response directly.

The sync engine reconciles a complete provider calendar-list response against existing sources for
that connection. It marks missing provider sources as removed and stops their watches. An upsert of
the same provider source clears `removed_at` and restores the existing layer and its Docket data.
The engine does not treat a partial event page as proof that an event was deleted.

The component diagram in
[`diagrams/2026-09-05-canonical-calendar-sources.mmd`](diagrams/2026-09-05-canonical-calendar-sources.mmd)
shows the boundary. Provider adapters produce identities and capabilities. The sync engine persists
them. The canonical read service resolves groups and occurrences. Product surfaces consume only
canonical output.

## Source Removal

`DELETE /v1/me/calendar/sources/:layerId/subscription` removes one upstream subscription when the
adapter reports that the source supports this action. The API rejects a provider primary calendar,
an owner-managed calendar, a source with pending provider writes, and a source with unresolved
conflicts.

Google removal needs `https://www.googleapis.com/auth/calendar.calendarlist`. Docket's normal
calendar connection will keep its current read and event scopes. The remove action requests the
wider scope only when needed. After OAuth returns, settings reopens the source row and asks for the
final destructive confirmation again. The redirect never removes a calendar by itself.

The adapter maps a provider `404` or `410` response to success because the requested end state
already exists. A canceled grant, wrong account, provider failure, or network failure changes no
local state. After provider success, the API stops the watch on a best-effort basis and soft-removes
the source in a transaction.

The shared adapter capability is named `removeSourceSubscription`. Google implements it with
CalendarList delete. A future Outlook adapter can map it to the corresponding Microsoft Graph
operation and permission without changing the route or settings component.

## API Shape

`CalendarSettingsOut` keeps its connection, calendar, and layer arrays for compatibility. It adds
logical source groups and combine suggestions. Each group returns its active sources, preferred
source, effective visibility, exact or confirmed provenance, and aggregate management state.

The source-group endpoints are:

- `POST /v1/me/calendar/source-groups` to confirm a suggested group.
- `PATCH /v1/me/calendar/source-groups/:id` to set visibility or preferred source atomically.
- `DELETE /v1/me/calendar/source-groups/:id` to separate a confirmed group.
- `DELETE /v1/me/calendar/sources/:layerId/subscription` to remove one upstream subscription.

Exact derived groups use a stable API id derived from their opaque identity key. A preference update
may persist that derived group before applying the preference. The web client never issues parallel
per-layer visibility requests.

## Failure And Privacy Rules

Provider exception text never reaches product copy. The API returns stable problem codes. Settings
owns the text for insufficient scope, protected sources, pending writes, wrong account, provider
failure, and retry.

Canonical output must not expose an event from a calendar the current user cannot read. Shared busy
views continue returning busy intervals without titles, item ids, layer ids, source counts, or
provider identities. Group resolution always runs inside the requesting user's authorization
boundary.

## Rejected Designs

Title-and-time event matching is rejected because two separate meetings can share both fields. It
also lets a title edit change identity.

Client-only deduplication is rejected because Calendar, Agenda, Today, exports, and future clients
would disagree. It also cannot merge Docket metadata correctly.

Deleting local source rows after provider cleanup is rejected because foreign-key cascades would
destroy task links, relationships, shares, and write history.

Requesting the source-management scope during every Google connection is rejected because most
people never remove an upstream subscription from Docket.

Hard-coding `iCalUID`, Google access roles, or CalendarList deletion into shared contracts is
rejected because Microsoft Graph exposes the same product concepts through different fields and
permissions.

## Open Limits

The first implementation adds the provider-neutral contract and Google behavior. It does not add a
Microsoft OAuth client or Microsoft sync adapter. Provider documentation must be checked again when
that adapter is built because Microsoft Graph permissions and deletion semantics may change.

An event copied by a person into a new independent provider event can receive a new provider
identity. Docket will keep those events separate unless the provider preserves the cross-calendar
identity. The first release does not add manual event-level grouping.
