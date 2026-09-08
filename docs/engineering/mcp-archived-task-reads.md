# Archived exact task reads

MCP client maintainers must use an authorized exact task read when they need to
distinguish archive state from an unavailable task. Curfew uses this read to end
a retained work session after Docket omits its task from active work.

As of September 8, 2026, `docket://{org}/task/{id}` and exact-ID `get` reads
return archived tasks when the caller has `work:read` and passes the canonical
task visibility check. The hydrated task includes `archivedAt` as an ISO timestamp
or `null`. For example, `"archivedAt": "2026-09-08T12:00:00.000Z"` confirms an
archive. A not-found response does not confirm an archive.

Cross-organization, inaccessible, and private unshared tasks remain not found.
The API still omits archived tasks from default lists, discovery, completion,
project task collections, both dependency directions, and subtask collections.
An archived root task can still have active visible dependencies and subtasks.
Comments on archived tasks remain unavailable.

`docket://hub/active-work` retains its tracked record but returns `task: null`
when that record points to an archived task. The client must read the exact
retained task to establish its archive state. The client must treat failed reads
as unknown state. This API change does not alter Curfew's local enforcement rules.
