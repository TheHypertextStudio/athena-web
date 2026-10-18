---
name: capture-work
description: Use when the user asks to capture, file, or triage a task in Docket, including turning an idea or reported problem into actionable work.
---

# Capture work

Read [Working in Docket](../../references/work-management.md) before writing.

Read [Agent assignments](../../references/agent-work.md) when filing work for execution: relate it
to the existing task/project or relevant program without inventing a hierarchy; honor explicit
requests to work outside Docket.

Resolve the intended workspace and destination, search for existing work, and read a fitting task
template. Capture the outcome and observable acceptance criteria using that template's full body.
Do not infer an assignee, urgency, due date, or expanded scope from an idea alone.

Use `capture` for a single quick task. When the current schema cannot express an explicit project or
team destination, prefer `organize` with one task and resolved placement rather than creating in the
wrong place and moving it. Check workload while adding work without turning capture into a scheduling
operation. Fill the body in the initial write when possible; otherwise complete the returned template
body immediately with `update`, preserving its structure. Read the saved task back and return its link.

For triage, read the unfiled queue with `list_work` and propose or apply only the requested placement,
priority, or assignment changes. Batch compatible updates and account for skipped items. For a larger
initiative, use the `plan-work` skill rather than capturing an unstructured pile of tasks.

Example: “File a task to retry failed uploads without duplicate attachments” becomes a task whose
acceptance covers a successful retry and repeated retries preserving one attachment. It does not imply
rewriting the upload service or scheduling the task today.
