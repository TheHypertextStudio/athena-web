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
 *
 * It stays read-only, unlike the entity card, and not by preference. A row here carries its state
 * key but not its team's workflow, so there is no way to know what "done" is called on the team
 * that owns it — `update` takes a per-team key, and the same list can span every team in the org.
 * Ticking a row off would mean either guessing a key or shipping every team's workflow down with
 * every page. The entity card, which is about one task on one team, is where that edit belongs.
 */
import { appDocument } from './runtime';

const BODY = `
<div class="head">
  <div class="headline" id="headline" aria-live="polite"></div>
  <button id="expand" class="quiet" hidden></button>
</div>
<div class="rows" id="rows"></div>
<div class="actions">
  <button id="open" class="quiet" hidden>Open in Docket</button>
</div>`;

const SCRIPT = String.raw`
(() => {
  const el = (id) => document.getElementById(id);
  const INLINE_ROWS = 4;
  let state = null;

  function row(item) {
    const node = document.createElement('div');
    node.className = 'row';

    // Tasks carry a canonical state type; containers do not, so the glyph appears on one and not
    // the other rather than being faked for both.
    const glyph = window.docket.stateGlyph(item.stateType);
    if (glyph) {
      node.appendChild(glyph);
    }

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = item.title || item.id;
    name.title = item.title || item.id;
    node.appendChild(name);

    // A task shows its workflow state; a container shows its status. One of the two is always set.
    const badge = item.state || item.status;
    if (badge) {
      const span = document.createElement('span');
      span.className = 'muted';
      // The team's own name for the state, spelled the way a person writes it. The glyph beside it
      // already carries the canonical type, so the two say different things on purpose.
      span.textContent = window.docket.label(badge);
      node.appendChild(span);
    }
    return node;
  }

  // Board order, so an expanded list reads the way the team's board does rather than alphabetically
  // or by whatever the query happened to return.
  const GROUP_ORDER = ['started', 'unstarted', 'backlog', 'completed', 'canceled'];
  const GROUP_NAME = {
    started: 'In progress',
    unstarted: 'Not started',
    backlog: 'Backlog',
    completed: 'Done',
    canceled: 'Canceled',
  };

  function renderInline(rows, items) {
    for (const item of items.slice(0, INLINE_ROWS)) {
      rows.appendChild(row(item));
    }
    if (items.length > INLINE_ROWS) {
      const more = document.createElement('div');
      more.className = 'muted';
      more.textContent = '…and ' + String(items.length - INLINE_ROWS) + ' more';
      rows.appendChild(more);
    }
  }

  function renderGrouped(rows, items) {
    // Grouping is the whole reason to go fullscreen: forty rows in query order is not more useful
    // than four, it is just longer.
    const seen = GROUP_ORDER.filter((type) => items.some((item) => item.stateType === type));
    const ungrouped = items.filter((item) => GROUP_ORDER.indexOf(item.stateType) === -1);
    for (const type of seen) {
      const heading = document.createElement('div');
      heading.className = 'group-label';
      const inGroup = items.filter((item) => item.stateType === type);
      heading.textContent = GROUP_NAME[type] + ' — ' + String(inGroup.length);
      rows.appendChild(heading);
      for (const item of inGroup) {
        rows.appendChild(row(item));
      }
    }
    if (ungrouped.length > 0) {
      const heading = document.createElement('div');
      heading.className = 'group-label';
      // Not "Other": these are rows whose team no longer lists their state key, and saying so is
      // more useful than a bucket name that explains nothing.
      heading.textContent = 'State not recognised — ' + String(ungrouped.length);
      rows.appendChild(heading);
      for (const item of ungrouped) {
        rows.appendChild(row(item));
      }
    }
  }

  function render() {
    if (!state) {
      return;
    }
    const items = state.items || [];
    const full = window.docket.displayMode === 'fullscreen';

    const noun = items.length === 1 ? (state.entity || 'item') : (state.entity || 'item') + 's';
    el('headline').textContent =
      items.length === 0
        ? 'Nothing matched'
        : String(items.length) + (state.nextCursor ? '+' : '') + ' ' + noun;

    const rows = el('rows');
    rows.replaceChildren();
    if (full) {
      renderGrouped(rows, items);
    } else {
      renderInline(rows, items);
    }

    const expand = el('expand');
    // Offered only when the host says it can honour it AND there is something behind the fold.
    // A control that expands four rows into four rows is noise.
    expand.hidden = !window.docket.canDisplay('fullscreen') || (!full && items.length <= INLINE_ROWS);
    expand.textContent = full ? 'Show less' : 'Show all';
    el('open').hidden = items.length === 0;
  }

  el('expand').addEventListener('click', () => {
    void window.docket.requestDisplayMode(
      window.docket.displayMode === 'fullscreen' ? 'inline' : 'fullscreen',
    );
  });

  // The host can move the view without being asked, so the mode drives the render rather than the
  // click doing so directly.
  window.docket.onDisplayMode(render);

  window.docket.onData((data) => {
    state = data;
    render();
  });

  el('open').addEventListener('click', () => {
    const orgId = window.docket.input.orgId;
    if (orgId) {
      window.docket.link('/orgs/' + orgId + '/tasks');
    }
  });
})();
`;

/** The rendered work-list document. */
export const WORK_LIST_HTML = appDocument('Work list', BODY, SCRIPT, {
  skeletonRows: 4,
  displayModes: ['inline', 'fullscreen'],
});
