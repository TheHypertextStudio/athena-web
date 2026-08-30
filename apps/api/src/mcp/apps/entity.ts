/**
 * `@docket/api` — semantic entity widgets.
 *
 * @remarks
 * Entity tools share a safe MCP App runtime, never a generic information architecture. A project
 * needs a briefing; a comment needs its writing; a session needs the work in motion. This document
 * factory therefore shares responsive primitives while every entity owns its composition.
 */
import { appDocument } from './runtime';

/** Every type the type-specific read tools can render. */
export type EntityDocumentType =
  | 'task'
  | 'project'
  | 'program'
  | 'initiative'
  | 'cycle'
  | 'team'
  | 'update'
  | 'comment'
  | 'session'
  | 'agent'
  | 'view'
  | 'org';

const BODY = `
<section class="entity-header">
  <div class="entity-kicker muted" id="kicker" hidden></div>
  <h1 class="entity-title" id="title" aria-live="polite"></h1>
  <p class="entity-narrative" id="narrative" hidden></p>
  <div class="entity-context" id="context" hidden></div>
</section>
<div class="entity-facts" id="details" hidden></div>
<div class="entity-sections" id="related"></div>
<div class="edits" id="edits" hidden>
  <label class="field">
    <span class="field-label" id="state-label">State</span>
    <select id="state"></select>
  </label>
  <label class="field">
    <span class="field-label">Due</span>
    <input id="due" type="date">
  </label>
</div>
<div class="actions" id="single-actions">
  <button id="open" class="quiet" hidden>Open in Docket</button>
</div>
<div class="batch-list" id="batch" hidden></div>
<p class="muted" id="missing" hidden></p>`;

function scriptFor(entityType?: EntityDocumentType): string {
  return (
    `const entityType = ${JSON.stringify(entityType ?? null)};\n` +
    String.raw`
(() => {
  const el = (id) => document.getElementById(id);
  let entity = null;
  let type = entityType || '';

  const labelFor = {
    task: 'Task', project: 'Project', program: 'Program', initiative: 'Initiative',
    cycle: 'Cycle', team: 'Team', update: 'Update', comment: 'Comment', session: 'Session',
    agent: 'Agent', view: 'Saved view', org: 'Organization',
  };

  function text(value) {
    return value === null || value === undefined || value === '' ? '' : String(value);
  }

  function label() {
    return labelFor[type] || 'Docket item';
  }

  function nameOf(item) {
    return text(item && (item.title || item.name || item.displayName)) || label();
  }

  function date(value) {
    const raw = text(value);
    return raw ? window.docket.label(raw.slice(0, 10)) : '';
  }

  function stateText(item) {
    const state = item && (item.state || item.status);
    return state ? window.docket.label(state) : '';
  }

  function appendText(parent, className, value) {
    const raw = text(value);
    if (!raw) return null;
    const node = document.createElement('div');
    node.className = className;
    node.textContent = raw;
    parent.appendChild(node);
    return node;
  }

  function renderHeader(title, narrative, context, kicker) {
    el('title').textContent = title || label();
    el('kicker').textContent = text(kicker);
    el('kicker').hidden = !text(kicker);
    el('narrative').textContent = text(narrative);
    el('narrative').hidden = !text(narrative);
    const root = el('context');
    root.replaceChildren();
    for (const item of context || []) {
      const value = text(item);
      if (value) appendText(root, 'entity-context-item', value);
    }
    root.hidden = root.childElementCount === 0;
  }

  function addFact(labelText, value) {
    const raw = text(value);
    if (!raw) return;
    const root = el('details');
    const item = document.createElement('div');
    item.className = 'entity-fact';
    const key = document.createElement('span');
    key.className = 'entity-fact-label';
    key.textContent = labelText;
    const detail = document.createElement('span');
    detail.className = 'entity-fact-value';
    detail.textContent = raw;
    item.append(key, detail);
    root.appendChild(item);
    root.hidden = false;
  }

  function previewContext(value) {
    if (!value || typeof value !== 'object') return '';
    const parts = [];
    const state = stateText(value);
    if (state) parts.push(state);
    if (value.health) parts.push(window.docket.label(value.health));
    if (value.targetDate) parts.push(date(value.targetDate));
    if (value.dueDate) parts.push(date(value.dueDate));
    return parts.join(' · ');
  }

  function appendSection(heading, values, options) {
    const visible = (values || []).filter(Boolean);
    if (visible.length === 0) return;
    const section = document.createElement('section');
    section.className = 'entity-section';
    const title = document.createElement('h2');
    title.className = 'entity-section-title';
    title.textContent = heading;
    section.appendChild(title);
    const list = document.createElement('div');
    list.className = 'entity-preview-list';
    for (const value of visible) {
      const item = document.createElement('div');
      item.className = 'entity-preview';
      const copy = document.createElement('div');
      copy.className = 'entity-preview-copy';
      const name = document.createElement('div');
      name.className = 'entity-preview-title';
      name.textContent = typeof value === 'string' ? value : nameOf(value);
      copy.appendChild(name);
      const secondary = typeof value === 'object' && options && options.secondary
        ? options.secondary(value)
        : previewContext(value);
      if (secondary) appendText(copy, 'entity-preview-secondary', secondary);
      item.appendChild(copy);
      if (typeof value === 'object' && value.href) {
        const open = document.createElement('button');
        open.className = 'quiet entity-preview-action';
        open.textContent = 'Open';
        open.setAttribute('aria-label', 'Open ' + nameOf(value) + ' in Docket');
        open.addEventListener('click', () => window.docket.link(value.href));
        item.appendChild(open);
      }
      list.appendChild(item);
    }
    section.appendChild(list);
    el('related').appendChild(section);
  }

  function appendNarrativeSection(heading, body) {
    const raw = text(body);
    if (!raw) return;
    const section = document.createElement('section');
    section.className = 'entity-section';
    const title = document.createElement('h2');
    title.className = 'entity-section-title';
    title.textContent = heading;
    const prose = document.createElement('p');
    prose.className = 'entity-section-narrative';
    prose.textContent = raw;
    section.append(title, prose);
    el('related').appendChild(section);
  }

  function clearDetail() {
    el('details').replaceChildren();
    el('details').hidden = true;
    el('related').replaceChildren();
  }

  function renderProject(item) {
    renderHeader(nameOf(item), item.description || item.summary, [
      stateText(item), item.health && window.docket.label(item.health), item.targetDate && 'Target ' + date(item.targetDate),
    ], 'Project');
    appendSection('Active work', item.tasks);
    appendSection('Milestones', item.milestones, { secondary: (value) => value.targetDate ? 'Target ' + date(value.targetDate) : '' });
    appendSection('Initiatives', item.initiatives);
    appendNarrativeSection('Latest update', item.latestUpdate && item.latestUpdate.body);
    if (typeof item.taskCount === 'number') addFact('Work items', item.taskCount + ' tasks');
  }

  function renderProgram(item) {
    renderHeader(nameOf(item), item.description || item.summary, [
      stateText(item), item.health && window.docket.label(item.health),
    ], 'Program');
    appendSection('Projects', item.projects);
    appendSection('Initiatives', item.initiatives);
    appendNarrativeSection('Latest update', item.latestUpdate && item.latestUpdate.body);
    if (item.rollup) addFact('Portfolio', item.rollup.projects + ' projects · ' + item.rollup.tasks + ' tasks');
  }

  function renderInitiative(item) {
    renderHeader(nameOf(item), item.description || item.summary, [
      stateText(item), item.health && window.docket.label(item.health), item.targetDate && 'Target ' + date(item.targetDate),
    ], 'Initiative');
    appendSection('Projects', item.projects);
    appendSection('Programs', item.programs);
  }

  function renderTask(item) {
    renderHeader(nameOf(item), item.description, [stateText(item)], 'Task');
    if (!Array.isArray(item.stateOptions)) addFact('State', stateText(item));
    addFact('Priority', item.priority && item.priority !== 'none' ? window.docket.label(item.priority) : '');
    if (!Array.isArray(item.stateOptions)) addFact('Due', date(item.dueDate));
    appendSection('Blocking', item.blocking);
    appendSection('Subtasks', item.subtasks);
  }

  function renderCycle(item) {
    renderHeader(nameOf(item), '', [
      stateText(item), item.startsAt && (date(item.startsAt) + (item.endsAt ? ' – ' + date(item.endsAt) : '')),
    ], 'Cycle');
    appendSection('Current work', item.tasks);
  }

  function renderTeam(item) {
    renderHeader(nameOf(item), item.description, [], 'Team');
    appendSection('People', item.members);
    appendSection('Workflow', (item.workflowStates || []).map((state) => ({ name: state.name || state.key })));
    addFact('Triage', item.triageEnabled ? 'Enabled' : 'Disabled');
  }

  function renderUpdate(item) {
    renderHeader('Update', item.body, [
      item.author && item.author.displayName && 'By ' + item.author.displayName,
      item.health && window.docket.label(item.health),
      item.createdAt && date(item.createdAt),
    ], 'Status update');
  }

  function renderComment(item) {
    renderHeader('Comment', item.body, [
      item.author && item.author.displayName && 'By ' + item.author.displayName,
      item.createdAt && date(item.createdAt),
      item.editedAt && 'Edited ' + date(item.editedAt),
    ], 'Comment');
  }

  function renderSession(item) {
    const taskTitle = item.task && item.task.title;
    const agentName = item.agent && item.agent.displayName;
    renderHeader(taskTitle || 'Agent session', agentName ? agentName + ' is working on this.' : '', [
      stateText(item), item.trigger && window.docket.label(item.trigger), item.startedAt && 'Started ' + date(item.startedAt),
    ], 'Session');
    appendSection('Recent activity', (item.activities || []).slice(-4).map((activity) => ({
      name: window.docket.label(activity.type),
      summary: activity.body && activity.body.text,
    })), { secondary: (activity) => text(activity.summary) });
  }

  function renderAgent(item) {
    renderHeader(nameOf(item), item.guidance, [
      item.approvalPolicy && window.docket.label(item.approvalPolicy),
      item.connection && item.connection.protocol && window.docket.label(item.connection.protocol),
    ], 'Agent');
  }

  function renderView(item) {
    renderHeader(nameOf(item), item.grouping ? 'Grouped by ' + window.docket.label(item.grouping) + '.' : '', [
      item.scope && window.docket.label(item.scope),
    ], 'Saved view');
  }

  function renderOrg(item) {
    renderHeader(nameOf(item), '', [], 'Organization');
    if (item.counts) addFact('Planning work', item.counts.teams + ' teams · ' + item.counts.projects + ' projects · ' + item.counts.programs + ' programs');
  }

  function renderEntity(item) {
    clearDetail();
    switch (type) {
      case 'project': return renderProject(item);
      case 'program': return renderProgram(item);
      case 'initiative': return renderInitiative(item);
      case 'task': return renderTask(item);
      case 'cycle': return renderCycle(item);
      case 'team': return renderTeam(item);
      case 'update': return renderUpdate(item);
      case 'comment': return renderComment(item);
      case 'session': return renderSession(item);
      case 'agent': return renderAgent(item);
      case 'view': return renderView(item);
      case 'org': return renderOrg(item);
      default: return renderHeader(nameOf(item), item.summary || item.description, [], label());
    }
  }

  function batchNarrative(item) {
    return text(item.description || item.summary || (item.latestUpdate && item.latestUpdate.body));
  }

  function batchStatus(item) {
    const parts = [stateText(item), item.health && window.docket.label(item.health)];
    if (type === 'project' && typeof item.taskCount === 'number') parts.push(item.taskCount + ' tasks');
    if (type === 'program' && item.rollup) parts.push(item.rollup.projects + ' projects · ' + item.rollup.tasks + ' tasks');
    if (type === 'initiative' && item.childMix) parts.push(item.childMix.projects + ' projects · ' + item.childMix.programs + ' programs');
    if (type === 'cycle' && Array.isArray(item.tasks)) parts.push(item.tasks.length + ' tasks');
    if (type === 'session' && Array.isArray(item.activities)) parts.push(item.activities.length + ' activities');
    if (type === 'org' && item.counts) parts.push(item.counts.projects + ' projects · ' + item.counts.programs + ' programs');
    return parts.filter(Boolean).join(' · ');
  }

  function renderBatch(items) {
    const batch = el('batch');
    batch.replaceChildren();
    for (const item of items) {
      const row = document.createElement('article');
      row.className = 'batch-item';
      const copy = document.createElement('div');
      copy.className = 'batch-copy';
      const name = document.createElement('div');
      name.className = 'batch-title';
      name.textContent = nameOf(item);
      copy.appendChild(name);
      const narrative = batchNarrative(item);
      if (narrative) appendText(copy, 'batch-context muted', narrative);
      const status = batchStatus(item);
      if (status) appendText(copy, 'batch-meta muted', status);
      row.appendChild(copy);
      if (item.href) {
        const open = document.createElement('button');
        open.className = 'quiet batch-action';
        open.textContent = 'Open';
        open.setAttribute('aria-label', 'Open ' + nameOf(item) + ' in Docket');
        open.addEventListener('click', () => window.docket.link(item.href));
        row.appendChild(open);
      }
      batch.appendChild(row);
    }
    batch.hidden = false;
  }

  function isTask() {
    return type === 'task' && entity && Array.isArray(entity.stateOptions);
  }

  function renderEdits() {
    const options = (entity && entity.stateOptions) || [];
    const select = el('state');
    select.replaceChildren();
    for (const option of options) {
      const node = document.createElement('option');
      node.value = option.key; node.textContent = option.name; node.selected = option.key === entity.state;
      select.appendChild(node);
    }
    const stateLabel = el('state-label');
    stateLabel.replaceChildren();
    const glyph = entity && window.docket.stateGlyph(entity.stateType);
    if (glyph) stateLabel.appendChild(glyph);
    stateLabel.appendChild(document.createTextNode('State'));
    el('due').value = entity && entity.dueDate ? String(entity.dueDate).slice(0, 10) : '';
    el('edits').hidden = !isTask();
  }

  async function edit(control, field, value, previous, after) {
    if (!isTask()) return;
    control.disabled = true;
    try {
      await window.docket.call('update', { orgId: window.docket.input.orgId, entity: 'task', scope: { ids: [entity.id] }, set: { [field]: value } });
      entity[field] = value;
      if (after) after();
      window.docket.notice('');
    } catch {
      control.value = previous;
      window.docket.notice('That could not be saved. Open Docket to check it.', 'error');
    } finally {
      control.disabled = false;
    }
  }

  el('state').addEventListener('change', async (event) => {
    if (!entity) return;
    const select = event.target;
    const selected = (entity.stateOptions || []).find((option) => option.key === select.value);
    await edit(select, 'state', select.value, entity.state, () => {
      entity.stateType = selected ? selected.type : undefined; renderEdits();
    });
  });

  el('due').addEventListener('change', async (event) => {
    if (!entity) return;
    const input = event.target;
    const previous = entity.dueDate ? String(entity.dueDate).slice(0, 10) : '';
    await edit(input, 'dueDate', input.value || null, previous);
  });

  el('open').addEventListener('click', () => {
    if (entity && entity.href) window.docket.link(entity.href);
  });

  window.docket.onData((data) => {
    const items = Array.isArray(data.items) ? data.items : [];
    type = entityType || window.docket.input.type || type;
    el('missing').hidden = !Array.isArray(data.missing) || data.missing.length === 0;
    if (!el('missing').hidden) el('missing').textContent = 'Some requested items could not be shown.';
    if (items.length === 0) {
      renderHeader('Nothing to show', 'Nothing here matches that any more.', [], '');
      clearDetail();
      return;
    }
    if (items.length > 1) {
      entity = null;
      renderHeader(items.length + ' ' + label().toLowerCase() + (items.length === 1 ? '' : 's'), '', [], '');
      el('details').hidden = true;
      el('related').replaceChildren();
      el('edits').hidden = true;
      el('single-actions').hidden = true;
      renderBatch(items);
      return;
    }
    entity = items[0];
    el('batch').hidden = true;
    el('single-actions').hidden = false;
    renderEntity(entity);
    renderEdits();
    el('open').hidden = !entity.href;
  });
})();`
  );
}

/** Build the legacy generic entity document or a document dedicated to one readable entity type. */
export function entityDocument(entityType?: EntityDocumentType): string {
  return appDocument(entityType ? `${entityType} details` : 'Entity', BODY, scriptFor(entityType), {
    skeletonRows: 1,
  });
}

/** The generic document retained for direct callers of the legacy `get` tool. */
export const ENTITY_HTML = entityDocument();
