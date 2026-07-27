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
<div class="card" id="card">
  <div class="headline" id="headline">Working…</div>
  <div class="rows" id="rows"></div>
  <div class="rows skipped" id="skipped"></div>
  <div class="actions">
    <button id="undo" hidden>Undo</button>
    <button id="open" hidden>Open in Docket</button>
  </div>
</div>`;

/**
 * The widget's script.
 *
 * @remarks
 * Reads `structuredContent`, which every write tool on this surface declares an `outputSchema` for
 * — so the card renders from the same contract the model reads, and the two cannot disagree about
 * what happened.
 */
const SCRIPT = String.raw`
(() => {
  const el = (id) => document.getElementById(id);
  const INLINE_ROWS = 3;
  let state = null;

  function text(node, value) { node.textContent = value; }

  function diffRow(item) {
    const row = document.createElement('div');
    row.className = 'row';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = item.title || item.id;
    row.appendChild(name);
    const fields = item.fields || [];
    if (fields.length > 0) {
      const d = document.createElement('span');
      d.className = 'diff';
      const f = fields[0];
      const from = document.createElement('span');
      from.className = 'from';
      from.textContent = f.field + ': ' + f.from;
      const arrow = document.createTextNode(' → ');
      const to = document.createElement('span');
      to.className = 'to';
      to.textContent = f.to;
      d.append(from, arrow, to);
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
    if (typeof data.changed === 'number') {
      const n = data.changed;
      const noun = n === 1 ? 'item' : 'items';
      return n === 0 ? 'Nothing changed' : 'Changed ' + n + ' ' + noun;
    }
    if (typeof data.created === 'number') {
      const parts = [];
      if (data.created > 0) parts.push('Created ' + data.created);
      if (data.matched > 0) parts.push('matched ' + data.matched + ' already there');
      return parts.length > 0 ? parts.join(', ') : 'Nothing to do';
    }
    if (data.title) return 'Captured “' + data.title + '”';
    return 'Done';
  }

  function itemsOf(data) {
    if (Array.isArray(data.changes)) return data.changes;
    if (Array.isArray(data.items)) return data.items;
    if (Array.isArray(data.placed)) {
      return data.placed
        .filter((p) => p.created)
        .map((p) => ({ id: p.id, title: p.ref, fields: [] }));
    }
    if (data.id) return [{ id: data.id, title: data.title, fields: [] }];
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

    const skipped = el('skipped');
    skipped.replaceChildren();
    for (const item of data.skipped || []) skipped.appendChild(skippedRow(item));

    el('undo').hidden = !data.changeSetId;
    el('open').hidden = items.length === 0;
  }

  el('undo').addEventListener('click', async () => {
    if (!state || !state.changeSetId) return;
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
      button.hidden = true;
      // Without this the agent keeps answering as though the change still stands.
      await window.docket.tell('The user undid that change from the report card. It no longer applies.');
    } catch (err) {
      const reason = document.createElement('div');
      reason.className = 'reason';
      reason.textContent = 'Could not undo: ' + (err && err.message ? err.message : 'unknown');
      el('card').appendChild(reason);
      button.disabled = false;
    }
  });

  el('open').addEventListener('click', () => {
    const items = state ? itemsOf(state) : [];
    const first = items[0];
    const orgId = window.docket.input.orgId;
    if (first && orgId) window.docket.link('/orgs/' + orgId + '/tasks/' + first.id);
  });

  window.docket.onResult((params) => {
    const data = params && params.structuredContent;
    if (!data) {
      text(el('headline'), 'No result to show');
      return;
    }
    render(data);
  });
})();
`;

/** The rendered change-report document. */
export const CHANGE_REPORT_HTML = appDocument('Change report', BODY, SCRIPT);
