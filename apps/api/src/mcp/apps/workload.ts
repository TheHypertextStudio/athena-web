/** Daily workload uses the embedded app shell, native controls, and shared host theme tokens. */
import { appDocument } from './runtime';
import { WORKLOAD_SCRIPT } from './workload-script';

const BODY = `
<style>
body { background:var(--color-background-primary); }
.skeleton { gap:16px; }
.skeleton .sk-row:nth-child(2) { height:48px; }
.skeleton .sk-row:nth-child(3) { height:96px; }
.skeleton .sk-row:nth-child(4) { height:80px; }
.skeleton .sk-row:nth-child(6) { height:80px; }
.workload-head { display:flex; align-items:start; justify-content:space-between; gap:16px; }
h1,h2,p { margin:0; } h1 { font-size:var(--font-heading-sm-size); line-height:var(--font-heading-sm-line-height); font-weight:600; }
h2 { font:inherit; font-weight:600; }
.workload-sub { color:var(--color-text-secondary); font-size:var(--font-text-sm-size); margin-top:4px; }
.workload-toolbar { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
.workload-toolbar button { white-space:nowrap; min-height:32px; }
.workload-settings { background:var(--color-background-secondary); padding:12px; border-radius:var(--border-radius-md); }
.workload-settings summary { cursor:pointer; font-weight:500; min-height:24px; }
.workload-fields { display:flex; flex-wrap:wrap; gap:12px; align-items:end; margin-top:12px; }
.workload-field { display:grid; gap:4px; min-width:0; flex:1 1 160px; font-size:var(--font-text-sm-size); color:var(--color-text-secondary); }
.workload-field input,.workload-field select { min-width:0; max-width:100%; width:100%; min-height:36px; padding:4px 8px; font:inherit; color:var(--color-text-primary); background:var(--color-background-primary); border:1px solid var(--color-border-primary); border-radius:var(--border-radius-md); }
.workload-metrics { margin:0; display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:16px; padding:8px 0; }
.workload-metric { min-width:0; display:grid; gap:4px; align-content:start; }
.workload-metric dt { color:var(--color-text-secondary); font-size:var(--font-text-sm-size); }
.workload-metric dd { margin:0; font-family:var(--font-mono); font-size:var(--font-heading-md-size,1.5rem); line-height:1.25; font-variant-numeric:tabular-nums; white-space:nowrap; }
.workload-metric small { display:block; margin-top:4px; white-space:normal; font-family:var(--font-sans); font-size:var(--font-text-sm-size); line-height:var(--font-text-sm-line-height); color:var(--color-text-secondary); }
.workload-metric[data-negative='true'] dd { color:var(--color-text-danger); }
.workload-note { padding:12px; background:var(--color-background-secondary); border-radius:var(--border-radius-md); font-size:var(--font-text-sm-size); }
.workload-notes { display:grid; gap:4px; }
.workload-chart { display:grid; gap:16px; }
.workload-chart,.workload-chart-row,#chart { min-width:0; grid-template-columns:minmax(0,1fr); }
#chart { display:grid; gap:16px; }
.workload-chart .workload-fields { margin-top:0; }
.workload-chart-row { display:grid; gap:4px; }
.workload-chart-label { display:flex; justify-content:space-between; gap:12px; }
.workload-chart-label span:first-child { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.workload-chart-value { flex-shrink:0; font-family:var(--font-mono); font-size:var(--font-text-sm-size); }
.workload-bar { height:8px; background:var(--color-background-secondary); border-radius:var(--border-radius-md); overflow:hidden; }
.workload-bar span { display:block; height:100%; min-width:0; }
.workload-bar.plan span { background:var(--color-text-secondary); opacity:.65; }
.workload-bar.actual span { background:var(--color-text-info); }
.workload-legend { display:flex; flex-wrap:wrap; gap:16px; color:var(--color-text-secondary); font-size:var(--font-text-sm-size); }
.workload-legend span::before { content:''; display:inline-block; width:16px; height:8px; margin-right:4px; background:var(--color-text-secondary); opacity:.65; }
.workload-legend .actual::before { background:var(--color-text-info); opacity:1; }
.workload-table { width:100%; border-collapse:collapse; table-layout:fixed; font-size:var(--font-text-sm-size); }
.workload-table th { text-align:left; color:var(--color-text-secondary); font-weight:500; }
.workload-table th:first-child { width:48%; }
.workload-table td,.workload-table th { padding:8px 4px; vertical-align:top; overflow-wrap:anywhere; }
.workload-table td:first-child { padding-left:0; }
.workload-table td:not(:first-child),.workload-table th:not(:first-child) { text-align:right; font-variant-numeric:tabular-nums; }
.workload-table tr + tr { border-top:1px solid var(--color-border-primary); }
@container (max-width:560px) {
 .workload-table thead { position:absolute; width:1px; height:1px; clip-path:inset(50%); overflow:hidden; }
 .workload-table tbody { display:grid; gap:12px; }
 .workload-table tr { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; padding:12px 0; }
 .workload-table td:first-child { grid-column:1/-1; }
 .workload-table td,.workload-table td:not(:first-child) { text-align:left; padding:0; }
 .workload-table td[data-label]::before { content:attr(data-label); display:block; color:var(--color-text-secondary); white-space:nowrap; }
 .workload-table .task-title { white-space:normal; }
}
.workload-table .task-title { display:block; overflow:hidden; text-overflow:ellipsis; }
.workload-detail { display:grid; gap:12px; }
.workload-detail summary { cursor:pointer; font-weight:500; min-height:32px; }
.workload-detail[open] summary { margin-bottom:12px; }
#quality { margin-top:8px; }
#quality summary { min-height:24px; font-weight:500; }
.workload-empty { padding:24px 0; display:grid; gap:8px; }
.workload-foot { font-size:var(--font-text-sm-size); color:var(--color-text-secondary); max-width:75ch; }
.workload-recovery { display:none; }
body[data-state='error'] .workload-recovery { display:block; }
.workload-status:empty { display:none; }
.workload-status { min-height:20px; font-size:var(--font-text-sm-size); color:var(--color-text-secondary); }
:where(input,select,summary):focus-visible { outline:2px solid var(--color-ring-primary); outline-offset:2px; }
@container (max-width:560px) { .workload-settings .workload-field { flex-basis:100%; } .workload-metrics { grid-template-columns:repeat(2,minmax(0,1fr)); gap:20px 12px; } .workload-head { flex-direction:column; gap:12px; } }
@container (max-width:360px) { .workload-chart-label { flex-direction:column; gap:0; } .workload-fields { gap:8px; } .workload-field { flex-basis:100%; } }
@media (pointer:coarse) { .workload-toolbar button, .workload-field input,.workload-field select,.workload-settings summary,.workload-detail summary,#quality summary,#apply,#retry,#retry-initial,#more { min-height:40px; } }
</style>
<div class="workload-head">
 <div><h1>Daily workload</h1><p class="workload-sub" id="scope"></p></div>
 <div class="workload-toolbar" aria-label="Day navigation">
  <button type="button" id="previous" class="quiet" aria-label="Previous day">←</button>
  <button type="button" id="today" class="quiet">Today</button>
  <button type="button" id="next-day" class="quiet" aria-label="Next day">→</button>
  <button type="button" id="refresh" class="quiet">Refresh</button>
 </div>
</div>
<details class="workload-settings" id="settings">
 <summary id="settings-label">Day settings</summary>
 <div id="day-form" class="workload-fields">
  <label class="workload-field">Day<input id="day" type="date" required></label>
  <label class="workload-field">Timezone<input id="timezone" required maxlength="100" autocomplete="off" spellcheck="false"></label>
  <label class="workload-field">Available hours<input id="hours" type="number" min="0" max="24" step="0.25" required aria-describedby="capacity-help"></label>
  <button type="button" id="apply">Apply</button>
 </div>
 <p class="workload-sub" id="capacity-help">Your full-day work budget. Changes apply to this view only.</p>
</details>
<div id="request-status" class="workload-status" role="status" aria-live="polite"></div>
<dl class="workload-metrics" aria-label="Visible workspace day totals" id="metrics"></dl>
<div class="workload-note"><div class="workload-notes" id="notes"></div><details class="workload-detail" id="quality"><summary id="quality-label">Tracking notes</summary><div class="workload-notes" id="quality-notes"></div></details></div>
<section class="workload-chart" aria-labelledby="breakdown-title">
 <div><h2 id="breakdown-title">Where the day goes</h2><p class="workload-sub">Chart filters keep the full-day budget and headline totals unchanged.</p></div>
 <div class="workload-fields">
  <label class="workload-field">Break down by<select id="group"><option value="project">Project</option><option value="priority">Priority</option><option value="task">Task</option></select></label>
  <label class="workload-field">Show<select id="filter"><option value="">All work</option></select></label>
  <label class="workload-field">Find a task<input id="search" type="search" placeholder="Task title" maxlength="200"></label>
 </div>
 <div class="workload-legend"><span>Known plan</span><span class="actual">Tracked so far</span></div>
 <p class="workload-sub" id="chart-summary" role="status"></p>
 <div id="chart"></div>
 <button type="button" id="more" class="quiet" hidden>Show more</button>
</section>
<details class="workload-detail"><summary>Task details</summary><table class="workload-table"><caption class="workload-sub">Current chart selection · durations in hours</caption><thead><tr><th scope="col">Task</th><th scope="col">Plan</th><th scope="col">Tracked</th><th scope="col">Left</th></tr></thead><tbody id="task-rows"></tbody></table><p class="workload-sub" id="table-count"></p></details>
<details class="workload-detail"><summary>How these numbers work</summary><p class="workload-foot">Planned work is your day-plan tasks and assigned tasks starting or due this day, including completed work. Past days use retained plans and current task metadata. A task counts once, using the larger of its estimate and timeboxed duration. Tracked time is the union of your human-active intervals through the snapshot time; simultaneous tasks split overlap equally. Both utilization percentages use the same full-day hours budget. Missing estimates make known plans and forecasts incomplete. Budget left means hours not yet tracked; forecast headroom also subtracts known unfinished work. Neither measure promises free calendar slots.</p></details>
<p class="workload-foot" id="snapshot"></p>
<p class="workload-foot">Visible work in the selected workspace only. Other workspaces, meetings, unnamed timers, breaks, and unrecorded work are excluded. No commitments change here.</p>`;

/** Self-contained MCP App document; no external scripts, styles, session cookies, or network access. */
export const WORKLOAD_HTML = appDocument('Daily workload', WORKLOAD_SCRIPT, {
  skeletonRows: 8,
}).replace(
  '<div class="content" id="view"></div>',
  `<div class="workload-recovery"><button type="button" id="retry-initial" class="quiet">Try again</button><p class="workload-sub">Check your Docket connection, then try loading this day again.</p></div><div class="content" id="view">${BODY}</div>`,
);
