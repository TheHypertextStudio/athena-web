/** Browser logic for the workload app. Values from tools are inserted only through textContent. */
export const WORKLOAD_SCRIPT = String.raw`
(() => {
 const el = (id) => document.getElementById(id);
 function syncState() {
  const state = document.body.dataset.state;
  document.querySelector('.card').setAttribute('aria-busy',String(state === 'loading' || state === 'stalled'));
  if (state === 'error') document.querySelector('.status').textContent = 'Could not load your daily workload.';
 }
 new MutationObserver(syncState).observe(document.body,{attributes:true,attributeFilter:['data-state']});
 syncState();
 let day = null;
 let requestVersion = 0;
 let rowLimit = 12;
 let lastArgs = null;
 const hours = (minutes) => minutes === null ? 'Unknown' : (minutes / 60).toLocaleString(undefined, { maximumFractionDigits: 1 }) + 'h';
 const counted = (n,label) => String(n) + ' ' + label + (n === 1 ? '' : 's');
 const percent = (value) => value === null ? 'No hours budget' : value.toLocaleString(undefined, { maximumFractionDigits: 0 }) + '% of day budget';
 function node(tag, text, className) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (className) n.className = className;
  return n;
 }
 function groupKey(task) {
  if (el('group').value === 'task') return task.id;
  if (el('group').value === 'priority') return task.priority;
  return task.projectId || (task.projectTitle ? 'restricted' : 'unfiled');
 }
 function groupLabel(task) {
  if (el('group').value === 'task') return task.title;
  if (el('group').value === 'priority') return window.docket.label(task.priority);
  return task.projectTitle || 'No project';
 }
 function populateFilters() {
  const before = el('filter').value;
  el('filter').replaceChildren(new Option('All work', ''));
  const seen = new Map();
  day.tasks.forEach((task) => seen.set(groupKey(task), groupLabel(task)));
  [...seen].sort((a,b) => a[1].localeCompare(b[1])).forEach(([key,label]) => el('filter').add(new Option(label,key)));
  if (seen.has(before)) el('filter').value = before;
 }
 function selectedTasks() {
  const query = el('search').value.trim().toLocaleLowerCase();
  return day.tasks.filter((t) => (!el('filter').value || groupKey(t) === el('filter').value) && t.title.toLocaleLowerCase().includes(query));
 }
 function metric(label, value, detail, negative) {
  const n = node('div', undefined, 'workload-metric');
  n.dataset.negative = String(Boolean(negative));
  const description = node('dd',value); description.append(node('small',detail));
  n.append(node('dt', label), description);
  return n;
 }
 function renderMetrics() {
  const t = day.totals;
  const partial = t.missingEstimates > 0;
  el('metrics').replaceChildren(
   metric(partial ? 'Known plan' : 'Full-day plan', hours(t.plannedMinutes), percent(t.expectedPercent) + (partial ? ' · incomplete' : ''), t.plannedHeadroomMinutes < 0),
   metric('Tracked so far', hours(t.trackedMinutes), percent(t.trackedPercent), false),
   metric('Budget left', hours(t.budgetLeftMinutes), 'Budget minus tracked time', t.budgetLeftMinutes < 0),
   metric(t.forecastHeadroomMinutes < 0 ? 'Over capacity' : 'Forecast headroom', hours(Math.abs(t.forecastHeadroomMinutes)), partial ? 'Before work with unknown duration' : 'After known unfinished work', t.forecastHeadroomMinutes < 0));
  const quality = [];
  const notes = [counted(t.plannedTasks,'task') + ' planned · ' + hours(t.remainingMinutes) + ' known unfinished work · ' + hours(t.remainingScheduledMinutes) + ' still scheduled after the snapshot.'];
  if (t.unknownDurations) notes.push(counted(t.unknownDurations,'planned task') + ' without an estimate or timebox. Duration is unknown; headroom is provisional.');
  const timeboxedWithoutEstimates = t.missingEstimates - t.unknownDurations;
  if (timeboxedWithoutEstimates > 0) notes.push(counted(timeboxedWithoutEstimates,'task estimate') + ' missing; the day plan uses timeboxed hours. Headroom is provisional.');
  if (timeboxedWithoutEstimates > 0) quality.push(counted(timeboxedWithoutEstimates,'task') + ' planned from timeboxes without task estimates. These hours describe the day plan, not confirmed total task effort.');
  if (t.untrackedCompleted) quality.push(counted(t.untrackedCompleted,'completed task') + ' without tracked time today. Unrecorded effort is unknown.');
  if (t.overlapMinutes > 0) quality.push(hours(t.overlapMinutes) + ' of overlapping timer entries counted once. Simultaneous tasks share that time equally.');
  if (t.scheduleOverlapMinutes > 0) quality.push(hours(t.scheduleOverlapMinutes) + ' of overlapping timeboxes. Scheduled coverage counts once, but task commitments still compete.');
  if (t.expectedPercent > 100) notes.push('Known plans exceed the selected day budget by ' + hours(-t.plannedHeadroomMinutes) + '.');
  if (day.availableHours === 0) notes.push('Set available hours to compare utilization. No percentage is defined for a zero-hour budget.');
  el('notes').replaceChildren(...notes.map((text) => node('p',text)));
  el('quality').hidden = quality.length === 0;
  el('quality-label').textContent = 'Tracking notes · ' + quality.length + (t.untrackedCompleted ? ' · ' + t.untrackedCompleted + ' untracked' : '');
  el('quality-notes').replaceChildren(...quality.map((text) => node('p',text)));
 }
 function chartRow(group, maximum) {
  const n = node('div', undefined, 'workload-chart-row');
  const label = node('div', undefined, 'workload-chart-label');
  const name = node('span',group.label); name.title = group.label;
  label.append(name, node('span',(group.unknown && !group.plan ? 'Unknown' : hours(group.plan) + (group.unknown ? ' + unknown' : '')) + ' / ' + hours(group.actual), 'workload-chart-value'));
  n.append(label);
  [['plan',group.plan],['actual',group.actual]].forEach(([kind,value]) => {
   const bar = node('div',undefined,'workload-bar ' + kind);
   const fill = node('span'); fill.style.width = String(Math.min(100,value / maximum * 100)) + '%';
   bar.setAttribute('aria-hidden','true'); bar.append(fill); n.append(bar);
  });
  n.setAttribute('role','img');
  n.setAttribute('aria-label',group.label + ': known plan ' + hours(group.plan) + (group.unknown ? ', plus unknown estimates' : '') + '; tracked ' + hours(group.actual));
  return n;
 }
 function renderTable(tasks) {
  el('task-rows').replaceChildren(...tasks.slice(0,rowLimit).map((t) => {
   const row = node('tr');
   const title = node('td'); const name = node('span',t.title,'task-title'); name.title = t.title;
   title.append(name, node('span',t.completed ? 'Completed' : t.planned ? (t.estimateMinutes === null && t.plannedMinutes !== null ? 'Planned from timebox · task estimate missing' : 'Planned') : 'Tracked outside plan','muted'));
   row.setAttribute('role','row'); title.setAttribute('role','cell'); row.append(title);
   [['Plan',t.plannedMinutes],['Tracked',t.trackedMinutes],['Left',t.remainingMinutes]].forEach(([label,value]) => {
    const cell=node('td',hours(value)); cell.dataset.label=label; cell.setAttribute('role','cell'); row.append(cell);
   });
   return row;
  }));
  el('table-count').textContent = tasks.length > rowLimit ? 'Showing ' + rowLimit + ' of ' + tasks.length + ' tasks. Use Show more above to expand.' : counted(tasks.length,'task') + ' in this selection.';
 }
 function renderChart() {
  const tasks = selectedTasks(); const groups = new Map();
  tasks.forEach((t) => {
   const key = groupKey(t);
   if (!groups.has(key)) groups.set(key,{ label:groupLabel(t), plan:0, actual:0, unknown:0 });
   const g = groups.get(key); g.plan += t.plannedMinutes || 0; g.actual += t.trackedMinutes;
   if (t.plannedMinutes === null) g.unknown++;
  });
  const rows = [...groups.values()].sort((a,b) => Math.max(b.plan,b.actual) - Math.max(a.plan,a.actual) || a.label.localeCompare(b.label));
  const maximum = Math.max(day.totals.availableMinutes, ...rows.map((g) => Math.max(g.plan,g.actual)), 1);
  el('chart-summary').textContent = tasks.length + ' tasks · plan / tracked · bar scale 0–' + hours(maximum) + ' · full-day budget ' + hours(day.totals.availableMinutes);
  if (!rows.length) {
   const empty = node('div',undefined,'workload-empty');
   empty.append(node('strong',day.tasks.length ? 'No work matches these filters' : 'No work recorded for this day'),
    node('p',day.tasks.length ? 'Choose All work or clear your task search.' : 'Plan tasks for this day or track work in Docket, then refresh. Due or starting assignments also appear here.'));
   el('chart').replaceChildren(empty);
  } else el('chart').replaceChildren(...rows.slice(0,rowLimit).map((g) => chartRow(g,maximum)));
  el('more').hidden = rows.length <= rowLimit && tasks.length <= rowLimit;
  renderTable(tasks);
  window.docket.resize();
 }
 function render(data) {
  if (!data || !Array.isArray(data.tasks) || !data.totals || !data.date) throw new Error('Invalid workload snapshot');
  day = data;
  lastArgs = { orgId:data.orgId, date:data.date, timezone:data.timezone, availableHours:data.availableHours };
  const date = new Date(data.date + 'T12:00:00Z').toLocaleDateString(undefined,{timeZone:'UTC',weekday:'short',month:'short',day:'numeric',year:'numeric'});
  el('scope').textContent = data.workspaceName + ' · ' + date;
  el('settings-label').textContent = 'Day settings · ' + data.timezone + ' · ' + data.availableHours + 'h budget';
  el('day').value = data.date; el('timezone').value = data.timezone; el('hours').value = String(data.availableHours);
  el('snapshot').textContent = 'Snapshot as of ' + new Date(data.asOf).toLocaleString(undefined,{timeZone:data.timezone,dateStyle:'medium',timeStyle:'short'}) + ' (' + data.timezone + '). Running timers stop at this snapshot; Refresh updates them.';
  populateFilters(); renderMetrics(); renderChart();
 }
 function args() {
  return { orgId:day ? day.orgId : window.docket.input.orgId,
   date:el('day').value || window.docket.input.date,
   timezone:el('timezone').value || window.docket.input.timezone,
   availableHours:el('hours').value === '' ? (window.docket.input.availableHours ?? 8) : Number(el('hours').value) };
 }
 async function load(input) {
  lastArgs = input; const version = ++requestVersion;
  el('request-status').textContent = 'Updating workload…';
  el('refresh').disabled = true; el('apply').disabled = true;
  try {
   const result = await Promise.race([window.docket.call('view_workload',input),new Promise((_,reject) => window.setTimeout(() => reject(new Error('timeout')),30000))]);
   if (version !== requestVersion) return;
   if (result.isError || !result.structuredContent) throw new Error('read failed');
   render(result.structuredContent); document.body.dataset.state = 'ready';
   window.docket.notice(''); el('request-status').textContent = 'Workload updated.';
   el('retry').hidden = true;
  } catch {
   if (version !== requestVersion) return;
   el('request-status').textContent = 'Could not update workload. Check the day, timezone, hours, and your connection, then try again.';
   el('retry').hidden = false;
   if (!day) window.docket.notice('Could not load your workload. Check your Docket connection and try again.','error');
  } finally {
   if (version === requestVersion) { el('refresh').disabled = false; el('apply').disabled = false; }
   window.docket.resize();
  }
 }
 const retry = node('button','Try again','quiet'); retry.id = 'retry'; retry.type = 'button'; retry.hidden = true;
 el('request-status').after(retry);
 retry.addEventListener('click',() => load(lastArgs || args()));
 el('retry-initial').addEventListener('click',() => load(args()));
 function applySettings() {
  if (![...el('day-form').querySelectorAll('input')].every((input) => input.reportValidity())) return;
  rowLimit = 12; load(args());
 }
 el('apply').addEventListener('click',applySettings);
 el('day-form').addEventListener('keydown',(event) => {
  if (event.key === 'Enter' && event.target.tagName === 'INPUT' && !event.isComposing) {
   event.preventDefault(); applySettings();
  }
 });
 el('refresh').addEventListener('click',() => load({orgId:day.orgId,date:day.date,timezone:day.timezone,availableHours:day.availableHours}));
 function shift(days) { const date = new Date((lastArgs?.date || day.date) + 'T12:00:00Z'); date.setUTCDate(date.getUTCDate() + days); rowLimit=12; load({...args(),date:date.toISOString().slice(0,10)}); }
 el('previous').addEventListener('click',() => shift(-1)); el('next-day').addEventListener('click',() => shift(1));
 el('today').addEventListener('click',() => { rowLimit=12; load({...args(),date:new Intl.DateTimeFormat('en-CA',{timeZone:day.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}); });
 el('group').addEventListener('change',() => { el('filter').value=''; rowLimit=12; populateFilters(); renderChart(); });
 el('filter').addEventListener('change',() => { rowLimit=12; renderChart(); });
 el('search').addEventListener('input',() => { rowLimit=12; renderChart(); });
 el('more').addEventListener('click',() => { rowLimit+=12; renderChart(); });
 window.docket.onData((data) => { ++requestVersion; render(data); el('request-status').textContent=''; el('refresh').disabled=false; el('apply').disabled=false; });
})();
`;
