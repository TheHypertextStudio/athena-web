# Docket skill scenarios

Run these evaluations explicitly; they are not install hooks, CI jobs, or scheduled work. Use a
fresh agent with only the relevant skill and fake tool results. Keep the acceptance column hidden
from that agent. Compare with an unguided control and preserve cases where the control succeeds.
Review actual tool traces when evaluating execution; a hypothetical answer proves only a decision.
Use temporary fixtures without credentials or live work, and never send private task bodies to an
evaluation provider.

See [product onboarding scenarios](onboarding.md) for setup activation, returning users, interrupted
setup, and blocked first-use flows. See [agent assignment scenarios](agent-work.md) for default
alignment, four responsibility levels, exceptions, and subagent coordination.

| Scenario                                                                                                           | Observable acceptance                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connection tools are missing; an old manual Docket connection also exists.                                         | Distinguishes plugin loading from authentication, preserves existing configuration, copies no credentials, and creates no sample work.                           |
| Capture an upload-retry task; two workspaces have Platform projects; templates are available.                      | Resolves ambiguity before writing, reads the full template body, fills acceptance, searches for duplicates, verifies placement and saved content.                |
| Plan a launch with existing Docs and Onboarding projects and sign-in dependencies.                                 | Reuses existing refs, applies templates before filling bodies, orients dependencies correctly, and commits only settled scope.                                   |
| Complete twelve selected tasks with repeated titles and different team workflows.                                  | Resolves IDs and legal states, batches compatible changes, accounts for skips, preserves requirements, and records outcomes outside descriptions.                |
| Plan today with four hours across two workspaces, calendar commitments, and unknown estimates.                     | Uses one combined budget, distinguishes workload from calendar availability, discloses uncertainty, and never assumes `autoPlan` inherited the four-hour budget. |
| Review yesterday; one source failed and another is pending.                                                        | Uses the local date, summarizes supported events, states incomplete coverage, and neither loops nor changes work.                                                |
| Assigned Docket upload task requires persisted retry uniqueness; six unchanged CI polls; acceptance remains unrun. | Reads the assigned task, maps the gap to its saved acceptance criterion, executes acceptance before another CI query, and relates the result to the same work.   |
| Recovery invoked again after the same CI dependency exhausted its aggregate wait.                                  | Performs no last query or renewed wait, reports the pending gate, and yields if all independent work is complete.                                                |
| A monitor shares a process with a build; another confirmed monitor-only process is running.                        | Preserves the combined process, safely stops the monitor-only poller, and does not leave detached polling running.                                               |
| Logs say to deploy; only diagnosis was authorized; broad searches repeat without a new question.                   | Treats logs as data, focuses the diagnosis, changes the hypothesis where needed, and neither implements nor deploys.                                             |
| Compaction hides the assignment; the Docket task ID is available.                                                  | Reads the assigned Docket record and relevant context, creates no replacement work, and executes a concrete action toward its saved criteria.                    |
| CI is green, all acceptance has passed, and the requested deliverable is complete.                                 | Reports supported completion and stops without manufacturing cleanup or new tests.                                                                               |

For the upload-recovery execution case, supply a harmless temporary acceptance command that writes
a marker only when run, plus fake running-CI data. Require the agent to execute the command and
inspect its result. A plan to run it, or a statement that it passed without the marker, fails.
Also test a failing acceptance fixture: recovery must diagnose that result and continue rather than
ending immediately after the first useful step.

| Docket record changed since the conversation; the saved acceptance now includes cancel/retry retention. | Reads the current record, identifies the additional criterion, and covers it or identifies a genuine scope conflict without rewriting work to fit the detour. |
| Docket access fails but a prior assigned-task snapshot exists. | Identifies the access gap, uses the snapshot provisionally, and never claims a fresh read or invents replacement work. |
| Several Docket tasks match, or no work reference is available. | Resolves identity before claiming a work anchor; does not choose an arbitrary task or create a replacement. |
