# Work Location Settings Simplification

> **Status**: Approved for implementation
> **Date**: 2026-08-14
> **Area**: Personal settings, saved places, expected-location schedules, device detection

## Objective

Make Work locations feel like a place list and schedule, not a control panel. A person should be
able to add a familiar place in seconds, recognize their saved places at a glance, and reach less
common changes without every action occupying the page permanently.

This is a focused redesign of the existing canonical work-location settings surface. It does not
change the resolver, provider convergence rules, or the independent home designation.

## Page Structure

The page opens with only the `Work locations` title and one primary `Add place` action. It has no
subtitle and no nested `Regular places` heading because both repeat the route's purpose.

Saved places render first as a dense, bordered list. The remainder of the page is ordered by user
intent:

1. `Schedule` for explicit expected locations.
2. `Planned work` when standing scheduling commitments exist.
3. `Automatic location` for the foreground browser opt-in.
4. `Calendar sync` for linked-account delivery state.

Each section uses one short heading. Explanatory copy appears only when it changes a decision or
explains a blocked action.

## Saved Places

`Add place` opens a dialog with:

- required `Name`;
- optional `Address`;
- optional `Choose on map` disclosure;
- `Cancel` and `Save place` actions.

A name alone is valid. The address is private owner-facing context and is not sent to calendar
providers. Choosing a map point stores private latitude/longitude through the existing geofence
field with a product-owned 250 metre matching radius. The radius is never shown or configurable.
The map is loaded only after the user asks for it, uses MapLibre GL JS with OpenFreeMap, and offers
ordinary pan/zoom, point selection, and a user-gesture `Use current position` control. No address
geocoding service is introduced in this slice; typing an address does not leak it to a third party.

Each saved place is one compact row:

- `Home` icon for the independently designated home, otherwise `Map pin`;
- name and optional address;
- small `Home`, `Current`, and provider-origin badges only when applicable;
- one target icon for `Set as current location` or `Clear manual current location`;
- one overflow menu containing `Edit`, `Make home` or `Clear home`, and `Retire`.

The target and overflow controls are icon-only because they are compact row utilities, not the
page's primary action. Both have accessible names, visible focus, and tooltips. Retirement remains
subject to the canonical active-reference conflict and is never primary-styled.

## Schedule And Planning

The schedule section has one `Add schedule` action and compact rows showing place, human schedule
summary, and imported state. Creation and series editing use one dialog. A schedule row overflow
menu contains `Edit schedule`, `Change one occurrence` for weekly series, and `Delete schedule`.

Occurrence changes move into a dedicated dialog. The user chooses a date and then cancels the
occurrence, moves it to another saved place, or restores the series occurrence. Date/time and DST
validation continue using the existing canonical helpers.

Standing commitments remain editable because they determine expected work, but they appear only
when commitments exist and use one compact row with a saved-place select. They do not carry a
self-describing paragraph.

## Automatic Location And Sync

Automatic location is one settings row. It says `Use this device while Docket is open` and has a
single `Start` or `Stop` action. It is disabled with concise guidance until at least one saved place
has a map point. Browser permission and freshness messages appear only after interaction. Raw
coordinates remain browser-local; the service still receives only a matched place id and accuracy.

Calendar sync is a compact account list with provider icon, account label, plain-language state,
and an action only when the account needs attention. A single short privacy note explains that
Google work-location events are public calendar events. Healthy rows have no inert buttons.

## Responsive And Accessible Behavior

Desktop rows keep identity, status, and utilities on one line. At mobile widths, identity text may
wrap within its column while both icon utilities remain visible as at least 40px touch targets.
Dialogs become width-constrained sheets within the viewport; the map is at least 240px tall and
never causes horizontal overflow. All primary flows are keyboard operable, map selection has an
equivalent current-position action, and icon-only controls expose labels and tooltips.

## Data And Privacy Changes

`WorkPlace` gains an optional nullable address with a 240-character limit. It is persisted under
the personal Hub, included in owner export/deletion with the place row, and omitted from compact
resolved-location summaries. Provider projection continues to use the canonical place name and
provider mapping only.

No hard-coded home/office place kind is added. Home remains an independent singular profile
relationship, and every person may keep any number of ordinary saved places.

## Verification

- Contract and repository tests cover name-only places, optional addresses, and fixed-radius map
  coordinates.
- Component tests prove the page has one add action, no radius controls or redundant places
  heading, compact row actions, dialog-based editing, and hidden occurrence controls.
- The Playwright journey covers add, edit, designate home, set current, schedule, and one-occurrence
  editing without relying on inline configuration fields.
- The Docket craft review captures 1440x900 and 390x844 screenshots in light and dark themes,
  checks 320px overflow and keyboard focus, and records the scorecard under `docs/design/audits/`.

## Non-Goals

- Address autocomplete or third-party geocoding.
- User-configurable detection radii.
- Background location sensing.
- Changes to canonical precedence or provider convergence.
- Microsoft account connection.
