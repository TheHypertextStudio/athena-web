/**
 * `@docket/api` — the work-list widget.
 *
 * @remarks
 * Chat is good at intent and bad at sets. "Everything Sarah has open" is a list a person needs to
 * *scan* before acting on it, and reading twenty titles back as prose is how an agent gets told to
 * go ahead with a change nobody actually checked.
 *
 * So this renders the count and the first few rows inline, and nothing else — no filter controls,
 * no sort, no text entry. The scope came from the sentence; changing it is another sentence, not a
 * form. What the widget adds over prose is that the set is *visible* and countable at a glance.
 */
import { appDocument } from './runtime';

const BODY = `
<div class="card">
  <div class="headline" id="headline">Loading…</div>
  <div class="rows" id="rows"></div>
  <div class="actions">
    <button id="open" hidden>Open in Docket</button>
  </div>
</div>`;

const SCRIPT = String.raw`
(() => {
  const el = (id) => document.getElementById(id);
  const INLINE_ROWS = 4;
  let state = null;

  function row(item) {
    const node = document.createElement('div');
    node.className = 'row';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = item.title || item.id;
    node.appendChild(name);
    // A task shows its workflow state; a container shows its status. One of the two is always set.
    const badge = item.state || item.status;
    if (badge) {
      const span = document.createElement('span');
      span.className = 'muted';
      span.textContent = String(badge).replace(/_/g, ' ');
      node.appendChild(span);
    }
    return node;
  }

  window.docket.onResult((params) => {
    const data = params && params.structuredContent;
    const items = (data && data.items) || [];
    state = data;

    const noun = items.length === 1 ? (data.entity || 'item') : (data.entity || 'item') + 's';
    el('headline').textContent =
      items.length === 0 ? 'Nothing matched' : String(items.length) + (data.nextCursor ? '+' : '') + ' ' + noun;

    const rows = el('rows');
    rows.replaceChildren();
    for (const item of items.slice(0, INLINE_ROWS)) rows.appendChild(row(item));
    if (items.length > INLINE_ROWS) {
      const more = document.createElement('div');
      more.className = 'muted';
      more.textContent = '…and ' + String(items.length - INLINE_ROWS) + ' more';
      rows.appendChild(more);
    }
    el('open').hidden = items.length === 0;
  });

  el('open').addEventListener('click', () => {
    const orgId = window.docket.input.orgId;
    if (orgId) window.docket.link('/orgs/' + orgId + '/tasks');
  });
})();
`;

/** The rendered work-list document. */
export const WORK_LIST_HTML = appDocument('Work list', BODY, SCRIPT);
