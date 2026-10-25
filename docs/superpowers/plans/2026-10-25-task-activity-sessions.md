# Task activity sessions implementation plan

**Goal:** Read agent work as coherent contributions within the shared task conversation.
**Spec:** `docs/engineering/specs/task-activity-sessions.md`
**Architecture:** Persist an optional logical work key in existing provenance JSON. Return opaque,
caller-qualified session descriptors on activity entries. Group adjacent entries across loaded
pages in the web presentation without changing canonical pagination or losing chronology.

## Constraints and review focus

- Correlation never grants permissions or proves delegation; transport handles stay private.
- Human interruptions, different callers and different sessions must not merge.
- Native session updates and mutations must agree on identity.
- All original events remain reachable, including long description changes and earlier updates.
- Counts are for loaded/filter-matching events; later pages must not duplicate containers.

## Steps

- [x] Add failing API tests for logical/connection/native identities, caller isolation, missing
      provenance, protocol validation and propagation; add failing web tests for grouping and expansion.
- [x] Add `activitySessionId` to provenance and an authenticated correlation parser. Wire REST
      headers and per-call MCP metadata through existing provenance scopes, including task handlers.
- [x] Add optional session descriptors to the activity contract and project them from canonical
      origins/session rows. Preserve authorization, cursor ordering and raw events.
- [x] Build a small adjacent-group presentation helper and a shared-primitive session container.
      Show the latest authored update, expandable prior updates and compact individual changes with
      deeper before/after disclosure. Preserve live delegation controls and the comment composer.
- [x] Run affected protocol/API/component tests, typechecks, lint and build; seed local realistic
      data and inspect both themes and widths using the existing verification harness.
- [x] Review the diff, document actual evidence and limitations, and commit the coherent slice.
