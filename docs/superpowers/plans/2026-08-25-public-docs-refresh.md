# Public Documentation Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Docket's Mintlify site into line with deployed production and prove the published
site works.

**Architecture:** Keep hand-written usage guides over the deployed product and leave endpoint detail
in Scalar. Preserve every existing URL, add eight missing guides, and use one synthetic production
workspace for screenshots and live journey checks.

**Tech Stack:** Mintlify MDX, `docs.json`, Vitest policy tests, Vercel, Cloud Run, and browser-based
visual review.

---

### Task 1: Freeze the production baseline

- [ ] Record the Vercel commit behind `docket.hypertext.studio`.
- [ ] Record the latest successful production API deployment and compare live OpenAPI paths with
      the current source.
- [ ] Inventory deployed user-facing features since the last `apps/docs` change.
- [ ] Keep unreleased behavior out of the public guide.

### Task 2: Rebuild the guide structure

- [ ] Update `apps/docs/docs.json` with Getting started, Daily work, Core concepts, Managing Docket,
      Athena, Developers, and Changelog.
- [ ] Add the eight approved guide pages and preserve every current path.
- [ ] Rewrite all existing pages against current labels and deployed behavior.
- [ ] Check every cross-link as each page changes.

### Task 3: Update developer guidance and the changelog

- [ ] Compare the developer pages with live OAuth metadata, MCP registration, stable errors, and
      Scalar anchors.
- [ ] Keep endpoint schemas out of Mintlify.
- [ ] Backfill grouped release entries from successful deployment dates and visible product slices.

### Task 4: Add visual evidence

- [ ] Create the `Docket Documentation Demo` workspace with synthetic work only.
- [ ] Capture Today with Agenda, Calendar with work locations, Time review, Views, Library, and
      Graph.
- [ ] Optimize the images, remove identifiers, and add useful alternative text and captions.
- [ ] Review the rendered site at 1440 by 900 and 390 by 844 in light and dark themes.

### Task 5: Validate, commit, and publish

- [ ] Run the documentation policy test and `npx mint broken-links`.
- [ ] Run formatting, lint, type checking, tests, and the production build with bounded concurrency.
- [ ] Commit the coherent docs slice with scope `docs` and the required co-author trailer.
- [ ] Rebase on current `origin/main`, verify linear history, and publish through `main`.
- [ ] Verify live navigation, search, assets, redirects, both LLM text files, and the illustrated
      journeys before closing the work log.
