---
name: review-work
description: Use when the user asks what they accomplished, requests a Docket retrospective, or wants a summary of completed work and remaining blockers.
---

# Review work

Read [Working in Docket](../../references/work-management.md) before using work tools.

Read [Agent assignments](../../references/agent-work.md) for project, initiative, or program
assessments. Review delivery, strategic outcome evidence, or operating expectations respectively;
do not substitute completed-task counts for those results.

Use `retrospect` for what happened on a local calendar day. Resolve relative dates in the person's
timezone; do not substitute the host's timezone. For an explicit range, read the requested days
without expanding the range. Use `brief` for what is waiting and semantic work reads for current
scope or blockers, keeping those distinct from historical accomplishments.

Group related events into meaningful outcomes, preserving source links and provenance. Distinguish
an activity, a claimed outcome, and verified acceptance. A task that is complete now does not prove
it was completed on the requested day. Avoid a transcript of every agent tool call.

Inspect overall status and each source. Pending or failed sources mean incomplete coverage, even
when other highlights are available. An empty successful source differs from a failed one. State
what could be read and what remains unknown; do not loop on an unchanged pending retrospective.

Return the review in conversation unless the user asked to save or post it. Posting an authorized
project/initiative/program update uses `report_status`; a task discussion uses `comment`. Do not put
the retrospective into task descriptions or silently change task states, health, or schedules.

Example: when yesterday's work includes a successful repository source and a failed calendar source,
summarize the supported work and name the calendar gap without claiming a complete account of the day.
