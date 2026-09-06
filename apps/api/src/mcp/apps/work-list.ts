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
  <div class="headline scope" id="headline" aria-live="polite"></div>
  <button id="expand" class="quiet" hidden></button>
</div>
<div class="rows" id="rows"></div>
<button id="rest" class="rest quiet" hidden></button>`;

const SCRIPT = String.raw`
(() => {
  const el = (id) => document.getElementById(id);
  const INLINE_ROWS = 4;
  let state = null;

  /**
   * The facts under a row's title, in the order they answer "should I look at this one".
   *
   * When it lands comes first and is the only thing here worth colour. Then where it lives, which
   * is what tells two similarly-named tasks apart. Then who owns it, but only when the list spans
   * more than one person — on "my tasks" every row says the same name, and a column that repeats
   * is a column that has stopped carrying information.
   *
   * The workflow state is the same argument. It is the row's own word, so it is worth showing when
   * it varies across the page and is pure noise when it does not — the card that started this
   * rework printed "Backlog" four times down its right edge and nothing else.
   */
  function factsOf(item, varying) {
    const facts = [];
    const due = window.docket.due(item.dueDate);
    if (due) {
      facts.push({ text: due.text, late: due.late });
    }
    const where = item.project || item.parent;
    if (where) {
      facts.push({ text: where });
    }
    if (item.cycle) {
      facts.push({ text: item.cycle });
    }
    if (varying.assignee && item.assignee) {
      facts.push({ text: item.assignee });
    }
    const badge = item.state || item.status;
    if (varying.state && badge) {
      facts.push({ text: window.docket.label(badge) });
    }
    return facts;
  }

  /** Which columns actually differ across the page, and are therefore worth a row's width. */
  function varyingFields(items) {
    const distinct = (pick) => new Set(items.map(pick).filter(Boolean)).size;
    return {
      assignee: distinct((item) => item.assignee) > 1,
      state: distinct((item) => item.state || item.status) > 1,
    };
  }

  function row(item, varying) {
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

    const facts = factsOf(item, varying);
    if (facts.length > 0) {
      const line = document.createElement('div');
      line.className = 'facts';
      facts.forEach((fact, index) => {
        if (index > 0) {
          const sep = document.createElement('span');
          sep.className = 'sep';
          sep.textContent = '·';
          line.appendChild(sep);
        }
        const span = document.createElement('span');
        if (fact.late) {
          span.className = 'late';
        }
        span.textContent = fact.text;
        line.appendChild(span);
      });
      node.appendChild(line);
    }

    // One link per row, not one per card. A card-level action that lands on the whole list makes
    // the reader find the row again in a second place.
    const open = window.docket.openButton(item);
    if (open) {
      node.appendChild(open);
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

  function renderInline(rows, items, varying) {
    for (const item of items.slice(0, INLINE_ROWS)) {
      rows.appendChild(row(item, varying));
    }
  }

  function group(rows, heading, items, varying) {
    const node = document.createElement('div');
    node.className = 'group-label';
    node.textContent = heading;
    rows.appendChild(node);
    for (const item of items) {
      rows.appendChild(row(item, varying));
    }
  }

  function renderGrouped(rows, items, varying) {
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
        group(rows, GROUP_NAME[type], inGroup, varying);
      }
    }

    if (loose.length === 0) {
      return;
    }
    // Only tasks carry a canonical state type. A container list — projects, programs, initiatives
    // — has none by design, and heading all of them "State not recognised" would report ordinary
    // data as damage. That warning is reserved for a task whose team dropped its state key.
    if ((state && state.entity) === 'task') {
      group(rows, 'State not recognised', loose, varying);
      return;
    }
    for (const item of loose) {
      rows.appendChild(row(item, varying));
    }
  }

  /**
   * The question this card is the answer to, read back from the arguments the tool was called with.
   *
   * A person cannot trust a list without knowing what was asked for. The count that used to sit
   * here — "5 tasks" — told them nothing they could not see, and said nothing about whether the
   * agent understood them; "Assigned to Sarah · due before Sep 12" is the thing they can check.
   *
   * Only filters that were passed as words are rendered. Every descriptor filter takes a name or
   * an id, and an id on this line would be worse than an empty one.
   */
  function scopeOf(input) {
    const parts = [];
    const named = (value) => typeof value === 'string' && value !== '' && !/^[a-z]+_[A-Za-z0-9]{10,}$/.test(value);
    if (named(input.assignee)) parts.push('assigned to ' + input.assignee);
    if (named(input.delegate)) parts.push('delegated to ' + input.delegate);
    if (named(input.lead)) parts.push('led by ' + input.lead);
    if (named(input.owner)) parts.push('owned by ' + input.owner);
    if (named(input.project)) parts.push('in ' + input.project);
    if (named(input.program)) parts.push('under ' + input.program);
    if (named(input.initiative)) parts.push('under ' + input.initiative);
    if (named(input.team)) parts.push('on ' + input.team);
    if (named(input.cycle)) parts.push('in ' + input.cycle);
    if (named(input.label)) parts.push('labelled ' + input.label);
    const states = [].concat(input.state || [], input.status || [], input.priority || []);
    if (states.length > 0) parts.push(states.map((value) => window.docket.label(value)).join(' or '));
    if (input.blocked === true) parts.push('blocked');
    if (input.unfiled === true) parts.push('not filed anywhere');
    if (input.archived === true) parts.push('archived');
    if (named(input.dueBefore)) parts.push('due before ' + window.docket.label(input.dueBefore));
    if (named(input.dueAfter)) parts.push('due after ' + window.docket.label(input.dueAfter));
    if (parts.length === 0) return '';
    const line = parts.join(' · ');
    return line.charAt(0).toUpperCase() + line.slice(1);
  }

  function render() {
    if (!state) {
      return;
    }
    const items = state.items || [];
    const full = window.docket.displayMode === 'fullscreen';
    const varying = varyingFields(items);

    const headline = el('headline');
    const scope = scopeOf(window.docket.input || {});
    // "Nothing matched" is worth saying because an empty card is otherwise indistinguishable from
    // a broken one. A populated card says what was asked, or says nothing and lets the rows talk.
    headline.textContent = items.length === 0 ? 'Nothing matched' + (scope ? ' — ' + scope.toLowerCase() : '') : scope;
    headline.hidden = headline.textContent === '';

    const rows = el('rows');
    rows.replaceChildren();
    if (full) {
      renderGrouped(rows, items, varying);
    } else {
      renderInline(rows, items, varying);
    }

    const expand = el('expand');
    const hidden = items.length - INLINE_ROWS;
    // Offered only when the host says it can honour it AND there is something behind the fold.
    // A control that expands four rows into four rows is noise.
    expand.hidden = !window.docket.canDisplay('fullscreen') || (!full && hidden <= 0);
    // The count earns its place here and nowhere else on this card: it is what the reader gets by
    // clicking, which is the one thing they cannot already see.
    expand.textContent = full ? 'Show less' : 'Show ' + String(hidden) + ' more';
    // When the host cannot expand, the rest of the list is only reachable in Docket — so the card
    // says so instead of dropping the remainder on the floor behind a count.
    const rest = el('rest');
    rest.hidden = full || hidden <= 0 || window.docket.canDisplay('fullscreen');
    rest.textContent = 'Open in Docket to see ' + String(hidden) + ' more';
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

  // The remainder lives one level up from any single row, and only a row carries an href — so this
  // opens the first one, which is the same list in the app.
  el('rest').addEventListener('click', () => {
    const first = (state && state.items) || [];
    if (first[0] && first[0].href) window.docket.link(first[0].href);
  });
})();
`;

/** The rendered work-list document. */
export const WORK_LIST_HTML = appDocument('Work list', BODY, SCRIPT, {
  skeletonRows: 4,
  displayModes: ['inline', 'fullscreen'],
});
