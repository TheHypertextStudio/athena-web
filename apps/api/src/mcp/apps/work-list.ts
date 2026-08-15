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

    // Every row in one response is the same kind, so a missing title can name what it's missing
    // — "Untitled project" reads as a real fact about the row, not a shrug.
    const untitled = window.docket.untitled(state && state.entity);
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = item.title || untitled;
    name.title = item.title || untitled;
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

  function group(rows, heading, items) {
    const node = document.createElement('div');
    node.className = 'group-label';
    node.textContent = heading + ' — ' + String(items.length);
    rows.appendChild(node);
    for (const item of items) {
      rows.appendChild(row(item));
    }
  }

  function renderGrouped(rows, items) {
    // Grouping is the whole reason to go fullscreen: forty rows in query order is not more useful
    // than four, it is just longer. One pass into buckets rather than a scan per group — this is
    // the code path built for the large result sets.
    const buckets = new Map();
    const loose = [];
    for (const item of items) {
      if (GROUP_ORDER.indexOf(item.stateType) === -1) {
        loose.push(item);
        continue;
      }
      const bucket = buckets.get(item.stateType);
      if (bucket) {
        bucket.push(item);
      } else {
        buckets.set(item.stateType, [item]);
      }
    }

    for (const type of GROUP_ORDER) {
      const inGroup = buckets.get(type);
      if (inGroup) {
        group(rows, GROUP_NAME[type], inGroup);
      }
    }

    if (loose.length === 0) {
      return;
    }
    // Only tasks carry a canonical state type. A container list — projects, programs, initiatives
    // — has none by design, and heading all of them "State not recognised" would report ordinary
    // data as damage. That warning is reserved for a task whose team dropped its state key.
    if ((state && state.entity) === 'task') {
      group(rows, 'State not recognised', loose);
      return;
    }
    for (const item of loose) {
      rows.appendChild(row(item));
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
