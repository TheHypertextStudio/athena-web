# Task activity identity and alignment — 2026-10-25

This local pass refines the accepted contribution direction. The entity's recorded work stays
primary. Sessions group activity over time; they do not own the task, imply execution duration,
or require a final update. No agent transcript is added to the entity history.

## Design and protocol

One 32px gutter aligns the session's agent identity with semantic document, relationship,
property and question icons. Header text, saved content and compact metadata rows use a common
content column. Individual edit disclosures stay subordinate and retain exact timestamps.
Human comments and continued contributions remain on the existing chronological spine.

The existing activity response adds optional `agentIconUrl` and a legacy `actorKind` hint.
Artwork comes from the registered native performer, registered agent actor, or authenticated
OAuth/CIMD client metadata. Resolution happens after access filtering and pagination in bounded
batches. An authorizing person's avatar is never borrowed for an agent. Missing or broken images
use a named agent/assistant glyph. Names do not select guessed provider logos. Shared avatars
now expose one named image role, including their fallback.

## Evidence

The standard capture tool produced twelve frames in
`/Volumes/WillieDrive/CodexScratch/docket-activity-icons-1961/shots/`:

- `simulated-icons-conversation-*`: authored comment, question, earlier update and visible mutations.
- `simulated-icons-mutations-*`: saved content and relationship without any authored final update.
- `simulated-icons-changes-*`: disclosed source timestamp and full before/after values.

Each state has 1440×900 and 390×844 frames in both themes, with 320px overflow checks.
Receipts are in the same artifact root's `receipts.jsonl`. Frames were inspected directly.
Phone conversation/expanded frames are intentionally scrolled into long content; the mutation-only
frames show the complete identity header. The task is created through the real local API and its
activity payload is an explicit presentation fixture. These are not connected-provider receipts.
The artwork behavior test uses an existing local app image as fixture artwork, not a Codex logo.

## Craft scorecard

| Dimension                      | Score | Evidence                                                                                                                                                                                                                                                                       |
| ------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Brand identity & voice         | 3     | Mutation-only frames retain the geometric spine, small corners and restrained tonal contribution. The heading names recorded work; performer and authority remain secondary.                                                                                                   |
| Typographic craft              | 3     | Plex action heading, secondary attribution/time and normal prose have distinct roles. No monospace timestamps. Expanded frames keep dates and Before/After labels subordinate.                                                                                                 |
| Spatial rhythm & density       | 3     | Header avatar, document/link glyphs and question glyph share a gutter. Saved content and relationship text align in both themes; phone values wrap within the same column.                                                                                                     |
| Hierarchy & information design | 3     | Description content and concrete relationship are visible without clicking. Questions remain visible. Only previous authored comments and exact edit history use disclosures.                                                                                                  |
| Color discipline               | 3     | All presentation uses shared semantic tokens. Neutral surfaces separate contribution/header/question in both themes; icon color does not invent completion or delegation. Scoped axe AA checks pass in both themes.                                                            |
| Motion & feedback              | 3     | Existing shared disclosures preserve keyboard focus and expanded state. The browser checks reduced-motion behavior and tokened chevron transitions.                                                                                                                            |
| States completeness            | 3     | Conversation, mutation-only and expanded states are captured. API tests cover real OAuth writer artwork, native avatars and legacy identity. Shared fallback tests pass. The focused browser check verifies loaded artwork, failed-image removal and the named glyph fallback. |
| Detail craft                   | 3     | Source timestamps remain accessible; description/link rows align; title/actions do not collide with the calendar open. Browser checks pass at 390/1440/1920px, 320px touch controls and 200% text.                                                                             |

## Gates and limits

- Accessibility: scoped axe AA checks pass in both themes after correcting the avatar fallback's
  semantic role. Keyboard focus, disclosure operation and coarse-pointer target checks pass.
- Responsive: capture overflow checks at 320px and browser bounds at 390/1440/1920px pass.
- Theme parity: both themes are captured and inspected for all three states.
- No placeholder: simulated presentation and artwork fixtures are identified above. No fake provider
  integration, ownership, delegation or completion is presented as real product behavior.
- Screenshot verification: all twelve frames captured; the rendered alignment was directly inspected.

All five browser behaviors pass: four checks in the complete run and the corrected artwork
selector in a focused rerun. The focused file lint also passes. The local stack was stopped and
the seeded shared database reset after verification.

The affected API/web/UI tests, package builds, typechecks, lint and unchanged complexity ledger pass.
The source was self-reviewed. Full manual screen-reader testing and production acceptance were not
performed. Slack/Discord mention aggregation remains separate, unfinished integration work.

Verdict: **SHIP for the local identity and alignment refinement.** Nothing deployed.
