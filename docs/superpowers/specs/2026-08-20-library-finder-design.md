# Library Finder and Resource Correctness Design

## Goal

Make Library the fastest place to find and open any workspace resource. The page searches the
complete resource corpus, browses resources by visible work context, and keeps large collections
responsive without adding native documents or a second filtering system.

## Product behavior

Library opens in grouped browse mode. Work context is the default grouping, and Display still
offers Source, Type, and no grouping. Initiative, Program, Project, and Team headers identify each
visible context. Resources without a visible context appear in a final Unreferenced group. A
resource that belongs to several contexts appears in each relevant group.

The existing view state, field catalog, Filter, Display, URL codec, and `applyView` implementation
remain authoritative. Library does not introduce local filter controls or a second representation
of view state.

A search query runs against the server's complete search corpus. Search results render as one flat,
relevance-ordered list. Clearing the query restores the prior grouped browse state and its scroll
position. Filters continue to apply while search is active, but client sorting and grouping do not
replace server relevance.

## Resource actions

The resource name is the primary action:

- External resources and URL attachments open the provider URL.
- Uploaded files use the authenticated attachment download route.
- Email, calendar, and other attachments without a provider action open their host Task, Project,
  or Initiative.
- A separate info action opens Docket context and backlinks without changing the primary action.

Attachments derive Work context from their host record and its visible hierarchy. They do not use
mention edges, because attachments are owned by a host rather than referenced through mentions.
Hidden host and container names never appear in the result.

The search projection carries attachment kind, file name, MIME type, byte size, and download action
data through the existing open-ended `SearchResult` facets and actions. This design needs neither a
database migration nor a new result schema.

## Loading and rendering

Library requests 50 resources per cursor page. It fetches another page when the virtual list nears
its end. The grouped rows and group headers become one measured virtual sequence with 12 rows of
overscan. A 10,000-row fixture may mount no more than 100 row elements.

An initial load failure replaces the roster with the existing page error treatment. A later-page
failure preserves every loaded row and places Retry at the virtual list's end. End-of-corpus state
does not trigger additional requests.

`EntityTable` gains optional `virtualized`, `onEndReached`, and `endAdornment` properties. The
default non-virtual path remains unchanged for all existing callers.

## Rejected alternatives

Native Library documents and a New document action solve a different product problem and remain
out of scope. Client-only search cannot search beyond loaded cursor pages. A fixed 100-row request
silently hides data. A Library-only filter bar would fork shared URL state and Display behavior.
Dashboard cards would make recent activity primary when the approved job is direct retrieval.

## Acceptance criteria

1. Library can retrieve resources beyond the first 100 records through server search and cursor
   browsing.
2. Work context is the default browse grouping, Unreferenced is last, and existing Display choices
   remain available.
3. Search results are flat and server ordered, and clearing search restores browse grouping and
   scroll position.
4. Every resource name opens or downloads the right target, while info opens Docket context.
5. Attachments show only visible host hierarchy names.
6. Later-page errors retain loaded rows and expose Retry at the list end.
7. Keyboard focus, collapsed groups, stable row keys, and URL view state survive virtualization.
8. A 10,000-row fixture mounts at most 100 row elements.
