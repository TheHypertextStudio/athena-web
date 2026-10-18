# Stop monitoring loops safely

## Interrupt the loop

Stop the repeated action now, without a last status check. Common loops include unchanged CI polls,
log refreshes, repeated searches, reopening the same files, redoing passed checks, rewriting plans,
and narrating activity while the actual acceptance gap stays untouched.

Safely stop a confirmed session-owned monitoring-only poller. Detaching it while it continues polling
does not stop the loop. Preserve builds, deployments, dirty work, remote jobs, unrelated processes,
and any process that combines useful work with monitoring. If a poller cannot be separated safely,
leave the useful process intact and stop further monitoring calls. Do not rerun CI or push a new
commit just to obtain a fresh signal.

## When waiting really is all that remains

Identify the exact acceptance dependency and account for its prior waits. Prefer a supported
completion notification; register it once. Otherwise use one aggregate wait of at most 60 seconds
or the lower host limit, then report pending and yield if it is inconclusive.

That allowance belongs to the same revision and dependency across jobs, tools, turns, and skill
re-entry. An expired allowance permits no final query. Lost wait history does not grant another
allowance. A newly appearing job, heartbeat, timestamp, partial matrix result, or unchanged failure
does not justify inspecting the whole run again. A terminal notification or new actionable failure
can justify the particular inspection it needs. An explicit user request to inspect now authorizes
one check, not a renewed watch loop.

Preserve explicitly requested monitoring through supported notifications or the user's finite
cadence within host limits. If that cannot be supported, report the limitation. Do not invent or
solicit an unlimited cadence, schedule a reminder, spawn a watcher, cancel jobs, or rerun them merely
to avoid yielding. Recovery does not authorize any of those actions.
