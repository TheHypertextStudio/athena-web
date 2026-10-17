# Athena personal-assistant and chief-of-staff capability audit

Assessment date: October 16, 2026. Web/API baseline: `099198dba`, equal to the
locally available `origin/main` at inspection. Android baseline: `ebcf3f1`; its
existing workflow and notification-documentation edits were left untouched. No
remote fetch, live provider operation, physical-device action, or fresh runtime
acceptance was performed. This is a source and retained-evidence audit.

## Finding

Athena has a substantial execution and supervision foundation. Its largest gap is
turning that foundation into dependable personal workflows: remembering relevant
facts, tracking promises, knowing when to revisit an outcome, and communicating
through everyday channels. Another channel alone will not close those gaps.

The recommendation is to finish one Docket-native follow-through workflow on the
existing assignment engine, then connect Gmail communication and everyday texting.
Telephone implementation should be accepted and extended rather than rebuilt.

## How to interpret status

- **Implemented foundation**: executable source, entry points, and relevant test
  coverage exist. This does not assert current deployed availability or a passing
  test run in this checkout.
- **Partial**: a meaningful subset exists, but the earlier user-facing expectation
  is broader, a critical integration is absent, or live acceptance remains open.
- **Missing**: no first-party implementation of the requested workflow was found
  in the inspected paths. Connected external MCP tools can add capabilities, but
  their hypothetical availability is not a supported Athena workflow.

## Personal-assistant baseline

| Expectation                        | Assessment             | Existing implementation and remaining gap                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Text Athena in an everyday channel | Missing workflow       | Web conversation exists. SMS sending, provider callback recording, and phone verification are infrastructure, but no conversational SMS/iMessage/WhatsApp/Telegram adapter into Athena was found. Recording an SMS reply does not resume Athena. Rich messages and cross-channel reply context are also unimplemented as a texting experience.                                                                                                                               |
| Call Athena                        | Partial                | Browser WebRTC voice, Twilio inbound calls, verified-number callbacks, caller authorization, interruption events, shared transcript, post-call review, and undo exist. The voice catalog contains only create task, list open tasks, and complete task. No complex outcome delegation or general external calling tool exists. The voice specification explicitly retains a live-number/call acceptance gap; current provisioned status was not inspected.                   |
| Reach the person proactively       | Partial                | Notification delivery supports web/email/SMS/push, quiet hours and preferences; day cadence creates check-ins and reorganizes drifted plans. Assignment events/schedules and notification triage can wake Athena. The conversation heads-up is a client-derived waiting-job notice with fixed thresholds, not a general personal interruption policy. Proactive urgent calls were not found. Provider transport configuration and delivery are not proven by adapter code.   |
| Capture anything                   | Partial                | Typed chat, page/work context, spoken task capture, inbound Athena email, Android sharing, and consented phone-notification ingestion exist. The chat composer sends text and contextual mentions, not a general photo/document/audio attachment workflow. Personal ingress currently dispatches captured/removed notification schemas, not arbitrary capture types. No common intent model separates a memory, reminder, delegation, and passing thought.                   |
| Persistent personal context        | Partial                | Durable conversation transcript, search, derived topic segments, chapter markers, user instructions, scheduling preferences, identity, work graph, and personal connections exist. No first-class editable fact/preference memory with provenance, freshness, correction and forgetting was found. Voice replays only 20 recent context lines, capped per line. Searchable history does not provide automatic reliable recall.                                               |
| Calendar ownership                 | Partial                | Google Calendar discovery, incremental synchronization, provider writes/outbox, native blocks, permissions, and deterministic availability-aware daily planning exist. These are substantial Docket capabilities. The first-party Athena MCP registration does not expose a full calendar meeting-management workflow. Attendee negotiation, invitation/reply management, travel buffers, and rescheduling a meeting across correspondents are not established.              |
| Inbox and communication            | Partial                | Gmail thread ingestion, metadata/snippets, mailbox state actions, email-to-task suggestions, automation, and Athena's inbound mailbox exist. The built-in mail action contract has archive/read/unread/trash/labels, with no compose/send/reply operation. No supported personal outbound correspondence plus unanswered-thread follow-up loop was found. Arbitrary connected MCP tools can extend this.                                                                     |
| Reminders and follow-through       | Partial                | Tasks have dates/dependencies, recurring work has schedules and history, assignments have event/interval triggers, and notifications/check-ins exist. No first-class promise/waiting-on model or complete natural-language conditional reminder flow was found. “If they have not replied by Thursday” needs thread-aware completion conditions and a reliable wake-up, beyond a dated task.                                                                                 |
| Personal routines                  | Partial                | Recurring Task/Project work, Program default schedules, workspace on/when/then automations, assignment schedules/events, and daily digests exist. Assignment triggers have CRUD routes, but the inspected Athena-specific tools only pause/remove them. No dedicated personal routine authoring/list/review surface or demonstrated conversational creation of such routines was found. Recurring work generation and recurring assistant execution are distinct mechanisms. |
| Research and deliverables          | Partial                | Athena can use Docket tools and linked personal/workspace MCP servers; Lattice can execute delegated work and return a proposal. Docket supports documents and attachments. No built-in supported web research, browser execution, spreadsheet/deck production, and artifact-validation suite was found. External tool availability determines much of this capability.                                                                                                      |
| Everyday logistics                 | Missing workflow       | No supported travel/booking/purchase/return/renewal execution workflows, payment authority limits, or general business-calling tools were found. Templates that describe such work do not implement it.                                                                                                                                                                                                                                                                      |
| Visible control                    | Implemented foundation | Conversation/work ledger, job states, action proposals, approval/rejection, elicitations, cancellation, provenance, in-Docket conflict-safe undo, connection management, and account lifecycle exist. External effects do not inherit Docket undo. This is one of the strongest foundations, although an outcome/routine-specific view remains a product gap.                                                                                                                |

## Chief-of-staff baseline

| Expectation                            | Assessment                         | Existing implementation and remaining gap                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Understand priorities and tradeoffs    | Partial                            | Docket has goals/work hierarchy, priorities, dependencies, workload reads, daily planning, protected availability, directive posture and drift reorganization. Athena can inspect these through tools. No retained acceptance establishes sustained cross-domain judgment, goal conflict resolution, or calibrated pushback; chief-of-staff wording in a prompt is not that evidence.                                                                         |
| Track commitments across conversations | Missing workflow                   | Work records, thread identities and tasks are useful substrates, but no dedicated extraction/confirmation lifecycle for my promises, others' promises, tentative ideas and decisions was found. Source-linked commitment ownership and settlement remain missing as a cohesive workflow.                                                                                                                                                                      |
| Own an outcome across days or weeks    | Partial                            | User-owned assignments on tasks/projects/initiatives persist objectives, status and active sessions. Scheduled/event triggers recheck access and dispatch work; approvals resume from durable state. However, generic assignments do not define verified outcome conditions, waiting-on correspondence, and autonomous closure of a personal workflow.                                                                                                        |
| Notice consequential changes           | Partial                            | Event ingestion, subtree-scoped assignment triggers, dependencies, phone-notification triage, and day drift signals exist. No generalized cross-source impact analysis or personalized urgency/attention model was found. Event matching is useful but does not itself reason about consequences.                                                                                                                                                             |
| Prepare decisions                      | Partial                            | Planning canvas, proposal groups, editable actions, clarifying elicitations and review surfaces exist. A model can write a brief. No consistent decision-brief workflow with source evidence, options, recommendation, uncertainty and decision deadline was found.                                                                                                                                                                                           |
| Coordinate delegated work              | Partial                            | Registered agent sessions, durable execution, Lattice delegation, external agent surfaces, returned proposals, human review and cancellation exist. Source and retained records show real Lattice returns. Multi-specialist selection, ongoing supervision and explicit deliverable acceptance are not established as a chief-of-staff workflow.                                                                                                              |
| Exercise discretion                    | Partial; strong authorization base | Athena belongs to its user, resolves current permissions, seals credentials, checks owner identity, limits phone tools, gates external/destructive actions, and uses provenance. The policy deliberately distrusts remote read-only annotations. Fine-grained standing authority by recipient/action/budget and contextual disclosure boundaries are not implemented as a personal policy system. Permission to read does not prove good disclosure judgment. |
| Recover without creating more work     | Partial; strong execution base     | Durable transcripts, re-entrant loops, outbox/lease recovery, dedupe, Lattice submission reconciliation, cancellation, access-loss handling and OAuth refresh exist. Retained records include actual production refresh and delegated-result evidence. They also leave a two-instance/restart proof open. Provider-specific exactly-once effects and complete ambiguous-outcome recovery cannot be inferred from the generic engine.                          |

## Evidence map

Paths below are relative to the Athena web repository unless marked Android.

| Area                                | Executable source                                                                                                                                                                                                           | Tests or retained evidence                                                                                                                                                                                                                                  |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conversation and context            | `apps/api/src/agent/transcript.ts`, `apps/api/src/routes/me-athena-conversation.ts`, `apps/api/src/routes/me-athena-chapters.ts`, `apps/api/src/agent/loop.ts`, `domains/planning/src/contracts/hub-preferences.ts`         | `apps/api/tests/agent/athena-conversation-browsing.test.ts`, `apps/api/tests/agent/athena-conversation-chapters.test.ts`, `apps/web/tests/athena/athena-conversation-retention.test.tsx`                                                                    |
| Voice and phone                     | `apps/api/src/routes/voice-session-service.ts`, `voice-tools.ts`, `twilio-voice.ts`, `twilio-telephony.ts`, `voice-engine.ts`; `apps/web/src/components/athena/voice-client.ts`                                             | `apps/api/tests/routes/voice-channel-parity.test.ts`, `voice-engine.test.ts`, `voice-tools.test.ts`, `phone-inbound-call.test.ts`; `docs/engineering/specs/voice-and-phone.md` section 12                                                                   |
| Assignments and routines            | `apps/api/src/agent/assignments.ts`, `apps/api/src/routes/personal-athena.ts`, `apps/api/src/routes/cron.ts`, `apps/api/src/mcp/athena-assignment-tools.ts`, `apps/api/src/lib/recurrence/`, `apps/api/src/lib/automation/` | `apps/api/tests/routes/personal-athena-assignments.test.ts`, `apps/web/e2e/work-template-program-routines.spec.ts`                                                                                                                                          |
| Attention and notification delivery | `apps/api/src/routes/day-cadence-sweep.ts`, `daily-digest.ts`; `domains/notifications/src/dispatch/`; `apps/web/src/lib/athena/heads-ups.ts`                                                                                | `apps/web/tests/athena/heads-ups.test.ts`, `apps/api/tests/services/notifications/dispatcher-sms-push.test.ts`                                                                                                                                              |
| Personal capture and triage         | `apps/api/src/services/inbound/ingest.ts`, `apps/api/src/services/device-notifications/triage-dispatch.ts`; Android `capture/ShareReceiverActivity.kt`, `notificationindex/NotificationSyncRunner.kt`                       | `apps/api/tests/routes/me-inbound.test.ts`, `notification-triage.test.ts`; Android notification integration/instrumentation tests. Prior managed-emulator and synthetic server/provider checks do not establish a fresh same-account phone-to-provider run. |
| Mail                                | `packages/integrations/src/gmail.ts`, `mail.ts`; `apps/api/src/lib/email-to-task/`; `apps/api/src/routes/inbound-mail-delivery.ts`, `athena-mail.ts`                                                                        | `packages/integrations/tests/providers/gmail.test.ts`; `apps/api/tests/routes/inbound-mail-delivery.test.ts` and failure-path companions                                                                                                                    |
| Calendar and planning               | `apps/api/src/routes/calendar-google-adapter.ts`; `apps/api/src/calendar/calendar-write.ts`, `calendar-outbox.ts`; `apps/api/src/mcp/plan-tools.ts`, `tools.ts`                                                             | `apps/api/tests/routes/calendar-write-back.test.ts`, `calendar-outbox-edges.test.ts`; plan and scheduling tests                                                                                                                                             |
| Authorization and review            | `apps/api/src/agent/approval-policy.ts`, `proposals.ts`; `apps/api/src/routes/me-athena-undo.ts`; `apps/web/src/components/athena/athena-work-ledger.tsx`                                                                   | `apps/api/tests/mcp/mcp-athena-user.test.ts`; `apps/api/tests/routes/me-athena-undo.test.ts`; `apps/web/tests/athena/work-ledger.test.tsx`                                                                                                                  |
| Durable execution                   | `apps/api/src/agent/async-runner.ts`, `loop.ts`, `lattice-delegations.ts`; `packages/db/src/schema/agents.ts`                                                                                                               | `apps/api/tests/agent/dispatch-outbox.test.ts`; retained October acceptance in `docs/WORKLOG.md` and `docs/engineering/specs/lattice-byo-model.md`                                                                                                          |

The old launch ledger contains contradictory historical snapshots, including claims
that telephony does not exist alongside its implemented acceptance rows. Treat these
as historical observations, not a current inventory. Likewise, an older spec saying
an area is shipped does not establish that the entire requested experience exists.

## Build order

### 1. Finish one owned follow-through workflow

Start with existing Docket work: “Keep this launch on track and bring me only the
decisions I need to make.” Use the existing assignment, task, event, approval,
notification and recovery services. Do not introduce a parallel work tracker or
scheduler.

Add an explicit source-linked commitment/expectation attached to canonical work:
who owes the next action, what success means, when to check, what event settles it,
and what Athena is allowed to do. Make capture, correction, pause and cancellation
understandable in conversation and the work ledger. Treat inferred promises as
proposals until confirmed.

An assignment run finishing must not silently mean the outcome is achieved. Persist
the waiting condition, revisit it through existing triggers, close it on observed
completion, and escalate only for a material blocker or decision. Introduce only
the personal memory needed for this flow, with an editable source and scope.

Acceptance: delegate a real bounded outcome, close every client, change a relevant
dependency, and observe one appropriate re-evaluation and notification. Completion
stops further nudges. Restart/retry does not duplicate work. Approval, rejection,
cancellation and revoked permissions work. The user can inspect the source and next
check. Run this through the actual selected provider, not only a model double.

### 2. Add a complete Gmail follow-up workflow

Extend the existing mail capability with drafts, replies and sending under explicit
authority. Correlate actual replies and settle waiting conditions. Support “If they
have not replied by Thursday, prepare a follow-up.” Keep send confirmation and
ambiguous provider outcomes explicit. This unlocks both personal administration and
meeting coordination; merely adding another connector does not.

### 3. Make Athena an everyday messaging contact

Choose one broadly usable messaging channel. SMS is a reasonable candidate given the
existing phone identity/notification foundation, but channel choice still needs its
own product and provider decision. Implement authenticated inbound conversation,
outbound response, dedupe, channel-specific opt-out, continuity and usable approvals.
Distinguish voice messages and MMS/media from plain SMS scope. Preserve one Athena
conversation and one assignment engine.

### 4. Productize personal routines

Expose creation, inspection, edit, pause and run history for the existing assistant
trigger machinery. Start with morning priorities, meeting preparation and a weekly
commitment review. Define completion and interruption rules; keep recurring Docket
work generation separate from recurring assistant runs while linking them clearly.

### 5. Finish telephone acceptance and delegation

Resolve actual number/provider availability, then demonstrate a real inbound call,
interruption, persisted transcript and continuation by text. Add a narrow spoken
handoff into durable assignments and screen-based approval. This can be a small
early acceptance workstream, but arbitrary business calling should follow reliable
communication, authority and recovery contracts.

General personal memory, broader decision preparation, specialist coordination,
travel/purchases and full cross-source consequence detection can grow from these
proven workflows. This is a product recommendation, not an implementation estimate
or an authorized change to the saved roadmap.

## Audit validation and limits

All 12 assistant expectations and eight chief-of-staff expectations are represented.
Findings were checked against source entry points, contracts, tool registrations,
test files and retained acceptance records. No product test suite was run: this
checkout initially had no installed dependencies and the audit changes no executable code.
Only the root and test-tooling dependency scope was installed for documentation
formatting and the repository's ordinary commit checks.
No current deployment/provider configuration or private user data was read.
Negative findings mean no implementation was found in the inspected repositories;
they do not rule out user-connected third-party MCP capabilities or unmerged work.
