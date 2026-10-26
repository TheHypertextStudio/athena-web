# Project header refinement Implementation Plan

> **For agentic workers:** Use native execution for this tightly coupled header slice.

**Goal:** Make project identity and operational context clear without template/setup clutter.

**Architecture:** Extend shared detail/metadata presentation with opt-in inline and wrapping
variants. Reuse the persistent template controller as the project overflow menu so preview
and capture dialogs survive menu dismissal.

**Tech Stack:** Existing React, @docket/ui, typed query/mutation layer and Playwright.

**Spec:** docs/superpowers/specs/2026-10-26-project-header-ux-design.md

## Global Constraints

- Owner, status, health and dates remain visible at all pane widths.
- Extra properties and template details remain usable with current permissions and dates.
- Use existing primitives and local guarded validation; preserve unrelated work.

## Review Focus

- Long titles and owner names do not displace actions or hide primary fields.
- Supplemental pickers persist edits and load choices only when opened.
- Menu dismissal retains template change/capture dialogs and restores focus.
- Read-only viewers retain meaningful fields and template provenance without mutation actions.
- Phone controls stay reachable and accessible in both themes.

### Task 1: Shared header and metadata presentation

- [x] Add focused behavior coverage for inline identity and wrapping essential metadata.
- [x] Add opt-in layout/overflow-label variants to shared detail/header rendering.
- [x] Use wrapping metadata in project details; put owner in the same group and mark extra fields overflow-only.

Files: entity-detail-layout.tsx, entity-detail-header-content.tsx, project-detail client,
project-detail/properties-panel.tsx, existing layout/property/people tests.

### Task 2: Project action menu

- [x] Add a menu presentation to existing template controls, keeping their controller mounted.
- [x] Compose repeat/trash with template details and actions in one project menu.
- [x] Cover provenance, read-only, change preview, capture and focus behavior.

Files: templates/work-template-{header,identity-control,choice-menu}.tsx,
new project-detail/project-header-actions.tsx, existing template tests.

### Task 3: Verify the complete interface

- [x] Run affected tests, typecheck, lint, complexity and production build.
- [x] Exercise actual project edits and menus in the browser.
- [x] Capture the standard desktop/phone/theme matrix; inspect and correct the rendered result.
- [x] Record craft review and worklog; commit the coherent UI slice.
