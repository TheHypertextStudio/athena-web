/**
 * `@docket/api` — the change-report widget.
 *
 * @remarks
 * This surface executes writes immediately instead of proposing them, which means the report card
 * is the only place a person ever sees what actually happened. So it shows **diffs, not end
 * states** — "Priority: High → Low" rather than "Priority: Low", because the second is not
 * checkable — and it gives `skipped` items the same visual weight as changed ones. A bulk write
 * routinely half-succeeds, and the half that did not is precisely the part prose buries.
 *
 * Undo lives here rather than in the transcript because taking a change back is a decision about a
 * specific set, and the card is the only place that set is visible. After undoing, the widget
 * pushes `ui/update-model-context` so the agent stops describing a change that no longer exists.
 */
import { appDocument } from './runtime';

/** The widget's markup: a headline, the diff rows, what was skipped, and two actions. */
const BODY = `
<div class="headline" id="headline" aria-live="polite"></div>
<div class="rows" id="rows"></div>
<div class="group-label" id="skipped-label" hidden></div>
<div class="rows skipped" id="skipped"></div>
<div class="actions">
  <button id="undo" hidden>Undo</button>
  <button id="open" class="quiet" hidden>Open in Docket</button>
</div>`;

/**
 * The widget's script.
 *
 * @remarks
 * Reads `structuredContent`, which every write tool on this surface declares an `outputSchema` for
 * — so the card renders from the same contract the model reads, and the two cannot disagree about
 * what happened.
 *
 * Waiting, stalling, cancellation and failure are the runtime's, not this file's. `onData` runs
 * only when there is a change set to draw.
 */
const SCRIPT = String.raw`
(() => {
  const el = (id) => document.getElementById(id);
  const INLINE_ROWS = 3;
  let state = null;

  // One card serves capture, update, archive and organize, so the verb comes from the tool the
  // host says it rendered rather than from the payload. "Changed 1 item" for an archive is not
  // wrong so much as useless: the person needs to know which of four things just happened.
  const VERB = {
    capture: 'Captured',
    update: 'Changed',
    archive: 'Archived',
    organize: 'Filed',
  };
  const NOTHING = {
    capture: 'Nothing captured',
    update: 'Nothing changed',
    archive: 'Nothing archived',
    organize: 'Nothing to file',
  };
  const LEFT_ALONE = {
    capture: 'Not captured',
    update: 'Not changed',
    archive: 'Not archived',
    organize: 'Not filed',
  };

  // Wire keys are not labels. Anything absent falls back to de-camel-casing, so a field added to a
  // write tool reads acceptably on the day it ships rather than as 'targetDate'.
  const FIELD_LABEL = {
    state: 'State',
    status: 'Status',
    dueDate: 'Due',
    startDate: 'Start',
    targetDate: 'Target',
    priority: 'Priority',
    title: 'Title',
    name: 'Name',
    description: 'Description',
    estimate: 'Estimate',
    assigneeId: 'Assignee',
    delegateId: 'Delegate',
    projectId: 'Project',
    programId: 'Program',
    milestoneId: 'Milestone',
    cycleId: 'Cycle',
    parentTaskId: 'Parent',
    health: 'Health',
    labels: 'Labels',
  };

  function toolName() {
    const info = window.docket.hostContext.toolInfo;
    return (info && info.tool && info.tool.name) || '';
  }

  function fieldLabel(field) {
    return (
      FIELD_LABEL[field] ||
      String(field).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())
    );
  }

  const valueLabel = (value) => window.docket.label(value);

  function text(node, value) { node.textContent = value; }

  function diffRow(item) {
    const row = document.createElement('div');
    row.className = 'row';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = item.title || item.id;
    name.title = item.title || item.id;
    row.appendChild(name);
    const fields = item.fields || [];
    if (fields.length > 0) {
      const d = document.createElement('span');
      d.className = 'diff';
      const f = fields[0];
      const label = document.createElement('span');
      label.className = 'muted';
      label.textContent = fieldLabel(f.field) + ' ';
      const from = document.createElement('span');
      from.className = 'from';
      from.textContent = valueLabel(f.from);
      const arrow = document.createTextNode(' → ');
      const to = document.createElement('span');
      to.className = 'to';
      to.textContent = valueLabel(f.to);
      d.append(label, from, arrow, to);
      // The clamp keeps the row a row; the full pair stays reachable on hover and to a screen
      // reader, because a truncated diff a person cannot expand is worse than no diff.
      d.title = fieldLabel(f.field) + ': ' + valueLabel(f.from) + ' → ' + valueLabel(f.to);
      if (fields.length > 1) {
        const more = document.createElement('span');
        more.className = 'muted';
        more.textContent = ' +' + String(fields.length - 1);
        d.appendChild(more);
      }
      row.appendChild(d);
    }
    return row;
  }

  function skippedRow(item) {
    const row = document.createElement('div');
    row.className = 'row';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = item.title || item.id;
    name.title = item.title || item.id;
    const reason = document.createElement('span');
    reason.className = 'reason';
    // Spelled out, because "not_permitted" is a wire value, not something to show a person.
    reason.textContent = ({
      not_permitted: 'you cannot edit this one',
      already_archived: 'already archived',
      not_archived: 'was not archived',
      changed_since: 'someone else changed it',
      gone: 'no longer exists',
    })[item.reason] || item.reason;
    row.append(name, reason);
    return row;
  }

  function headlineFor(data) {
    const tool = toolName();
    const verb = VERB[tool] || 'Changed';

    if (typeof data.changed === 'number') {
      const n = data.changed;
      if (n === 0) {
        return NOTHING[tool] || 'Nothing changed';
      }
      return verb + ' ' + n + ' ' + (n === 1 ? 'item' : 'items');
    }
    if (typeof data.created === 'number') {
      const parts = [];
      if (data.created > 0) {
        parts.push(verb + ' ' + data.created);
      }
      if (data.matched > 0) {
        parts.push('matched ' + data.matched + ' already there');
      }
      return parts.length > 0 ? parts.join(', ') : NOTHING[tool] || 'Nothing to do';
    }
    if (data.title) {
      return verb + ' “' + data.title + '”';
    }
    return 'Done';
  }

  function itemsOf(data) {
    if (Array.isArray(data.changes)) {
      return data.changes;
    }
    if (Array.isArray(data.items)) {
      return data.items;
    }
    if (Array.isArray(data.placed)) {
      return data.placed
        .filter((p) => p.created)
        .map((p) => ({ id: p.id, title: p.ref, fields: [] }));
    }
    if (data.id) {
      return [{ id: data.id, title: data.title, fields: [] }];
    }
    return [];
  }

  function render(data) {
    state = data;
    text(el('headline'), headlineFor(data));

    const rows = el('rows');
    rows.replaceChildren();
    const items = itemsOf(data);
    for (const item of items.slice(0, INLINE_ROWS)) rows.appendChild(diffRow(item));
    if (items.length > INLINE_ROWS) {
      const more = document.createElement('div');
      more.className = 'muted';
      more.textContent = '…and ' + String(items.length - INLINE_ROWS) + ' more';
      rows.appendChild(more);
    }

    const left = data.skipped || [];
    const skipped = el('skipped');
    skipped.replaceChildren();
    for (const item of left) {
      skipped.appendChild(skippedRow(item));
    }
    // A bulk write routinely half-succeeds. Without a heading the untouched half reads as more of
    // the same list, which is the one reading that makes the card actively misleading.
    const skippedLabel = el('skipped-label');
    skippedLabel.hidden = left.length === 0;
    skippedLabel.textContent =
      left.length === 0
        ? ''
        : (LEFT_ALONE[toolName()] || 'Not changed') + ' — ' + String(left.length);

    el('undo').hidden = !data.changeSetId;
    el('open').hidden = items.length === 0;
  }

  el('undo').addEventListener('click', async () => {
    if (!state || !state.changeSetId) {
      return;
    }
    const button = el('undo');
    button.disabled = true;
    try {
      await window.docket.call('undo', {
        orgId: window.docket.input.orgId,
        changeSetId: state.changeSetId,
      });
      text(el('headline'), 'Undone');
      el('rows').replaceChildren();
      el('skipped').replaceChildren();
      el('skipped-label').hidden = true;
      button.hidden = true;
      // Without this the agent keeps answering as though the change still stands.
      await window.docket.tell('The user undid that change from the report card. It no longer applies.');
    } catch {
      // The message stays beside the rows rather than replacing them: what could not be undone is
      // exactly the thing the person needs to still be looking at.
      window.docket.notice('That could not be undone. Open Docket to check it.', 'error');
      button.disabled = false;
    }
  });

  el('open').addEventListener('click', () => {
    const items = state ? itemsOf(state) : [];
    const first = items[0];
    const orgId = window.docket.input.orgId;
    if (first && orgId) {
      window.docket.link('/orgs/' + orgId + '/tasks/' + first.id);
    }
  });

  window.docket.onData(render);
})();
`;

/** The rendered change-report document. */
export const CHANGE_REPORT_HTML = appDocument('Change report', BODY, SCRIPT, { skeletonRows: 2 });
