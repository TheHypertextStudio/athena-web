/**
 * `@docket/api` — semantic entity widgets.
 *
 * @remarks
 * A model should choose the tool that names the thing it needs — `get_projects`, not an untyped
 * `get` plus a type switch. The documents still share this renderer because their lifecycle,
 * batching behaviour, and security boundary are identical; only the facts that deserve space
 * differ by entity type.
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
<div class="headline" id="title" aria-live="polite"></div>
<div class="muted" id="summary" hidden></div>
<div class="rows" id="details"></div>
<div id="related"></div>
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
<div class="rows" id="batch" hidden></div>
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

  function label() {
    return labelFor[type] || 'Docket item';
  }

  function text(value) {
    return value === null || value === undefined || value === '' ? '' : String(value);
  }

  function nameOf(item) {
    return text(item && (item.title || item.name || item.displayName)) || label();
  }

  function date(value) {
    const raw = text(value);
    return raw ? window.docket.label(raw.slice(0, 10)) : '';
  }

  function fact(labelText, value) {
    const raw = text(value);
    if (!raw) return null;
    const row = document.createElement('div');
    row.className = 'row';
    const key = document.createElement('span');
    key.className = 'muted';
    key.textContent = labelText;
    const valueEl = document.createElement('span');
    valueEl.className = 'name';
    valueEl.textContent = raw;
    row.append(key, valueEl);
    return row;
  }

  function stateText(item) {
    const state = item && (item.state || item.status);
    return state ? window.docket.label(state) : '';
  }

  function summaryFor(item) {
    if (!item) return '';
    if (type === 'update' || type === 'comment') return text(item.body);
    if (type === 'agent') return text(item.guidance);
    return text(item.summary || item.description);
  }

  function batchSummary(item) {
    const parts = [];
    const state = stateText(item);
    if (state) parts.push(state);
    if (item.health) parts.push(window.docket.label(item.health));
    if (type === 'project' && typeof item.taskCount === 'number') parts.push(item.taskCount + ' tasks');
    if (type === 'program' && item.rollup) parts.push(item.rollup.projects + ' projects · ' + item.rollup.tasks + ' tasks');
    if (type === 'initiative' && item.childMix) parts.push(item.childMix.projects + ' projects · ' + item.childMix.programs + ' programs');
    if (type === 'cycle' && Array.isArray(item.tasks)) parts.push(item.tasks.length + ' tasks');
    if (type === 'session' && Array.isArray(item.activities)) parts.push(item.activities.length + ' activities');
    if (type === 'org' && item.counts) parts.push(item.counts.projects + ' projects · ' + item.counts.programs + ' programs');
    return parts.join(' · ') || summaryFor(item);
  }

  function appendGroup(labelText, values) {
    const visible = (values || []).filter(Boolean);
    if (visible.length === 0) return;
    const root = el('related');
    const heading = document.createElement('div');
    heading.className = 'group-label';
    heading.textContent = labelText;
    root.appendChild(heading);
    const rows = document.createElement('div');
    rows.className = 'rows';
    for (const value of visible) {
      const row = document.createElement('div');
      row.className = 'row';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = typeof value === 'string' ? value : nameOf(value);
      row.appendChild(name);
      const when = value && typeof value === 'object' && value.targetDate ? date(value.targetDate) : '';
      if (when) {
        const meta = document.createElement('span');
        meta.className = 'muted';
        meta.textContent = when;
        row.appendChild(meta);
      }
      rows.appendChild(row);
    }
    root.appendChild(rows);
  }

  function renderFacts(item) {
    const details = el('details');
    details.replaceChildren();
    el('related').replaceChildren();
    const add = (key, value) => {
      const row = fact(key, value);
      if (row) details.appendChild(row);
    };

    switch (type) {
      case 'task':
        if (!Array.isArray(item.stateOptions)) add('State', stateText(item));
        add('Priority', item.priority && item.priority !== 'none' ? window.docket.label(item.priority) : '');
        if (!Array.isArray(item.stateOptions)) add('Due', date(item.dueDate));
        add('Blocked by', Array.isArray(item.blockedBy) && item.blockedBy.length ? item.blockedBy.length + ' task' + (item.blockedBy.length === 1 ? '' : 's') : '');
        appendGroup('Blocking', item.blocking);
        appendGroup('Subtasks', item.subtasks);
        break;
      case 'project':
        add('Status', stateText(item)); add('Health', item.health && window.docket.label(item.health));
        add('Target', date(item.targetDate)); add('Work', typeof item.taskCount === 'number' ? item.taskCount + ' tasks' : '');
        appendGroup('Milestones', item.milestones); appendGroup('Initiatives', item.initiatives);
        if (item.latestUpdate && item.latestUpdate.body) add('Latest update', item.latestUpdate.body);
        break;
      case 'program':
        add('Status', stateText(item)); add('Health', item.health && window.docket.label(item.health));
        if (item.rollup) add('Work', item.rollup.projects + ' projects · ' + item.rollup.tasks + ' tasks');
        appendGroup('Projects', item.projects); appendGroup('Initiatives', item.initiatives);
        if (item.latestUpdate && item.latestUpdate.body) add('Latest update', item.latestUpdate.body);
        break;
      case 'initiative':
        add('Status', stateText(item)); add('Health', item.health && window.docket.label(item.health));
        add('Target', date(item.targetDate));
        if (item.childMix) add('Associated work', item.childMix.projects + ' projects · ' + item.childMix.programs + ' programs');
        appendGroup('Projects', item.projects); appendGroup('Programs', item.programs);
        break;
      case 'cycle':
        add('Status', stateText(item)); add('Window', date(item.startsAt) + (item.endsAt ? ' – ' + date(item.endsAt) : ''));
        appendGroup('Tasks', item.tasks);
        break;
      case 'team':
        add('Key', item.key); add('Triage', item.triageEnabled ? 'Enabled' : 'Disabled');
        appendGroup('Workflow states', (item.workflowStates || []).map((state) => ({ name: state.name || state.key })));
        appendGroup('Members', item.members);
        break;
      case 'update':
        add('Health', item.health && window.docket.label(item.health)); add('Published', date(item.createdAt));
        break;
      case 'comment':
        add('Published', date(item.createdAt)); add('Edited', date(item.editedAt));
        break;
      case 'session':
        add('Status', stateText(item)); add('Trigger', item.trigger && window.docket.label(item.trigger));
        add('Started', date(item.startedAt)); add('Finished', date(item.endedAt));
        appendGroup('Activity', (item.activities || []).map((activity) => ({ name: window.docket.label(activity.type) })));
        break;
      case 'agent':
        add('Approval policy', item.approvalPolicy && window.docket.label(item.approvalPolicy));
        add('Connection', item.connection && item.connection.protocol && window.docket.label(item.connection.protocol));
        break;
      case 'view':
        add('Scope', item.scope && window.docket.label(item.scope)); add('Grouping', item.grouping && window.docket.label(item.grouping));
        break;
      case 'org':
        if (item.counts) add('Workspaces', item.counts.teams + ' teams · ' + item.counts.projects + ' projects · ' + item.counts.programs + ' programs');
        break;
    }
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
    const due = el('due');
    due.value = entity && entity.dueDate ? String(entity.dueDate).slice(0, 10) : '';
    el('edits').hidden = !isTask();
  }

  async function edit(control, field, value, previous, description, after) {
    if (!isTask()) return;
    control.disabled = true;
    try {
      await window.docket.call('update', { orgId: window.docket.input.orgId, entity: 'task', scope: { ids: [entity.id] }, set: { [field]: value } });
      entity[field] = value;
      if (after) after();
      window.docket.notice('');
      await window.docket.tell(description);
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
    await edit(select, 'state', select.value, entity.state, 'The user updated this task from the Docket card.', () => {
      entity.stateType = selected ? selected.type : undefined; renderEdits();
    });
  });

  el('due').addEventListener('change', async (event) => {
    if (!entity) return;
    const input = event.target;
    const previous = entity.dueDate ? String(entity.dueDate).slice(0, 10) : '';
    await edit(input, 'dueDate', input.value || null, previous, 'The user updated this task due date from the Docket card.');
  });

  el('open').addEventListener('click', () => {
    if (entity && entity.href) window.docket.link(entity.href);
  });

  function renderBatch(items) {
    const batch = el('batch');
    batch.replaceChildren();
    for (const item of items) {
      const row = document.createElement('div'); row.className = 'row';
      const name = document.createElement('span'); name.className = 'name'; name.textContent = nameOf(item);
      row.appendChild(name);
      const summary = batchSummary(item);
      if (summary) { const meta = document.createElement('span'); meta.className = 'muted'; meta.textContent = summary; row.appendChild(meta); }
      if (item.href) {
        const open = document.createElement('button'); open.className = 'quiet'; open.textContent = 'Open';
        open.setAttribute('aria-label', 'Open ' + nameOf(item) + ' in Docket');
        open.addEventListener('click', () => window.docket.link(item.href)); row.appendChild(open);
      }
      batch.appendChild(row);
    }
    batch.hidden = false;
  }

  window.docket.onData((data) => {
    const items = Array.isArray(data.items) ? data.items : [];
    type = entityType || window.docket.input.type || type;
    el('missing').hidden = !Array.isArray(data.missing) || data.missing.length === 0;
    if (!el('missing').hidden) el('missing').textContent = 'Some requested items could not be shown.';
    if (items.length === 0) {
      el('title').textContent = 'Nothing to show'; el('summary').hidden = false;
      el('summary').textContent = 'Nothing here matches that any more.'; return;
    }
    if (items.length > 1) {
      entity = null; el('title').textContent = items.length + ' ' + label().toLowerCase() + (items.length === 1 ? '' : 's');
      el('summary').hidden = true; el('details').hidden = true; el('related').hidden = true; el('edits').hidden = true;
      el('single-actions').hidden = true; renderBatch(items); return;
    }
    entity = items[0]; el('batch').hidden = true; el('details').hidden = false; el('related').hidden = false; el('single-actions').hidden = false;
    el('title').textContent = nameOf(entity);
    const summary = summaryFor(entity); el('summary').textContent = summary; el('summary').hidden = !summary;
    renderFacts(entity); renderEdits(); el('open').hidden = !entity.href;
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
