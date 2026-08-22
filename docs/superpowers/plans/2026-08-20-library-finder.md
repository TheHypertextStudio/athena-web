# Library Finder Implementation Plan

**Goal:** Turn Library into a complete, direct resource finder with correct attachment context and
bounded rendering for large workspaces.

**Architecture:** The search index owns corpus retrieval, attachment metadata, and resource
actions. The shared view layer owns filters, grouping, URL state, and virtual table rendering.
Library composes those contracts through a 50-row infinite query and keeps grouped browse state
separate from flat server-ranked search presentation.

**Tech Stack:** TypeScript, Hono, Drizzle, TanStack Query, TanStack Virtual, React, Vitest, Testing
Library, and Playwright.

## Implementation sequence

- [x] Add failing API tests for attachment host hierarchy, visibility gates, file facets, and
      primary search actions. Implement the projection and resolver changes without a migration.
- [x] Add failing shared-view tests for the Work context empty label, active Display copy, and
      virtual EntityTable behavior. Implement opt-in virtualization with 12-row overscan, end
      callbacks, retry adornments, collapse state, keyboard navigation, and stable keys.
- [x] Add failing Library tests for 50-row cursor accumulation, duplicate suppression, automatic
      loading, retry, terminal pages, grouped browse state, flat search, scroll restoration, and
      all resource action kinds.
- [x] Replace the fixed query with the shared infinite-query layer. Make Work context the default
      grouping, add full-corpus server search, and wire Name and info to separate actions.
- [x] Update attachment details so hosts and provider actions replace the invalid attachment
      backlink query. Preserve external-resource backlinks.
- [x] Add responsive browser coverage for search, Filter, Display, direct open, download, context,
      and narrow layouts. Add the deterministic 10,000-row DOM-bound test.
- [x] Run focused tests, package typechecks, then the repository typecheck, lint, test, build,
      accessibility, and E2E gates with bounded concurrency.
- [x] Review the owned diff, update the worklog with validation and retrospective evidence, and
      commit the feature with a linear history.

## Risks and controls

Virtualization can break focus and group collapse if rendered indices replace stable row identity.
The table will keep semantic keys and explicit keyboard scrolling. Infinite queries can discard
useful data after a later error, so Library will distinguish initial failure from next-page failure.
Attachment ownership can disclose hidden names if visibility checks run after hierarchy expansion,
so the resolver will gate both the host and its chosen container before it projects labels.

## Assumptions

Native documents remain out of scope. Search results remain ungrouped. Group counts describe loaded
resources. Uploaded files are task attachments and keep using the existing authenticated download
route. No new dependency or database migration is required.
