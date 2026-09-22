/**
 * `@docket/api` — the work-list widget.
 *
 * @remarks
 * Chat is good at intent and bad at sets. "Everything Sarah has open" is a list a person needs to
 * *scan* before acting on it, and reading twenty titles back as prose is how an agent gets told to
 * go ahead with a change nobody actually checked.
 *
 * The header restates the question the list answers, read back from the tool's arguments, because a
 * person cannot trust a list without knowing what was asked for. The rows are grouped the way the
 * team's board groups them — in progress, not started, backlog, done — each group its own section,
 * so the set has a shape before a single title is read. Inline shows the first few rows in board
 * order; fullscreen shows every row.
 *
 * It stays read-only. A row carries its state key but not its team's workflow, and one list can
 * span every team in the org, so there is no way to know what "done" is called on the team that
 * owns a row. The entity card, which is about one task on one team, is where that edit belongs.
 */
import { appDocument } from './runtime';

const SCRIPT = String.raw`
(() => {
  const d = window.docket;
  const INLINE_ROWS = 5;
  let state = null;

  const GROUP_ORDER = ['started', 'unstarted', 'backlog', 'completed', 'canceled'];
  const GROUP_NAME = { started: 'In progress', unstarted: 'Not started', backlog: 'Backlog', completed: 'Done', canceled: 'Canceled' };
  const { plural, noun: nounOf } = d;

  /**
   * The facts under a row's title, in the order they answer "should I look at this one": when it
   * lands (the only fact worth colour), where it lives, and who owns it when the list spans people.
   */
  function factsOf(item, varying) {
    const facts = [];
    const due = d.due(item.dueDate);
    if (due) facts.push({ text: due.text, late: due.late });
    if (item.project || item.parent) facts.push(item.project || item.parent);
    if (item.cycle) facts.push(item.cycle);
    if (varying && item.assignee) facts.push(item.assignee);
    return facts;
  }

  /**
   * Board groups for tasks, keyed by the canonical type and never by the per-team key, so a state
   * its team no longer lists lands in its own group instead of passing for a real one. Containers
   * group by their own status.
   */
  function groupKey(item) {
    if (state.entity === 'task') return item.stateType || '';
    return item.status || item.state || '';
  }

  function groupsOf(items) {
    const groups = new Map();
    for (const item of items) {
      const key = groupKey(item);
      groups.set(key, (groups.get(key) || []).concat([item]));
    }
    const keys = [...groups.keys()].sort((a, b) => rank(a) - rank(b));
    return keys.map((key) => ({ key, name: groupName(key), items: groups.get(key) }));
  }

  function rank(key) {
    const index = GROUP_ORDER.indexOf(key);
    return index === -1 ? GROUP_ORDER.length : index;
  }

  function groupName(key) {
    if (d.own(GROUP_NAME, key)) return d.own(GROUP_NAME, key);
    if (!key) return (state && state.entity) === 'task' ? 'State not recognised' : 'No status';
    return d.label(key);
  }

  /**
   * The question this card answers, read back from the arguments the tool was called with. Only
   * filters passed as words are shown: an id here would say less than nothing.
   */
  function scopeOf(input) {
    const parts = [];
    const named = (value) => typeof value === 'string' && value !== '' && !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
    const phrases = [
      ['assignee', 'assigned to '], ['delegate', 'delegated to '], ['lead', 'led by '], ['owner', 'owned by '],
      ['project', 'in '], ['program', 'under '], ['initiative', 'under '], ['team', 'on '], ['cycle', 'in '],
      ['label', 'labelled '],
    ];
    for (const [key, phrase] of phrases) if (named(input[key])) parts.push(phrase + input[key]);
    const states = [].concat(input.state || [], input.status || [], input.priority || []);
    if (states.length > 0) parts.push(states.map((value) => d.label(value)).join(' or '));
    if (input.blocked === true) parts.push('blocked');
    if (input.unfiled === true) parts.push('not filed anywhere');
    if (input.archived === true) parts.push('archived');
    if (named(input.dueBefore)) parts.push('due before ' + d.label(input.dueBefore));
    if (named(input.dueAfter)) parts.push('due after ' + d.label(input.dueAfter));
    const line = parts.join(' · ');
    return line.charAt(0).toUpperCase() + line.slice(1);
  }

  /** "12 tasks", or "50+ tasks" when the page runs past what this card holds. */
  function countLabel(count, noun) {
    if (state.nextCursor) return String(count) + '+ ' + noun + 's';
    return plural(count, noun);
  }

  /** The question the list answers, or its size when it was asked with no filters. */
  function headerTitle(count, scope, countText) {
    if (count === 0) return 'Nothing matched';
    return scope || countText;
  }

  function row(item, varying) {
    return {
      anchor: d.stateGlyph(item.stateType) || d.kindIcon(state.entity),
      title: item.title, kind: state.entity, href: item.href,
      meta: factsOf(item, varying),
    };
  }

  function draw() {
    if (!state) return;
    const items = state.items || [];
    const noun = nounOf(state.entity);
    const scope = scopeOf(d.input || {});
    const count = countLabel(items.length, noun);
    const view = d.canvas();
    view.appendChild(d.header({
      kind: state.entity, kicker: noun.charAt(0).toUpperCase() + noun.slice(1) + 's',
      title: headerTitle(items.length, scope, count),
      chips: [items.length > 0 && scope ? count : ''],
      lede: items.length === 0 ? scope : '',
    }));
    if (items.length === 0) return;
    const varying = new Set(items.map((item) => item.assignee).filter(Boolean)).size > 1;
    if (d.fullscreen) {
      for (const group of groupsOf(items)) {
        const section = d.section({ label: group.name, count: group.items.length });
        for (const item of group.items) section.body.appendChild(d.row(row(item, varying)));
        view.appendChild(section.node);
      }
      const foot = d.footer([state.nextCursor ? loadMore() : null]);
      if (foot) view.appendChild(foot);
      return;
    }
    // Inline, the first rows in board order as one list: each row's glyph already says its state,
    // and a heading per group would spend the card's height on labels.
    const ordered = groupsOf(items).flatMap((group) => group.items);
    const section = d.section({});
    for (const item of ordered.slice(0, INLINE_ROWS)) section.body.appendChild(d.row(row(item, varying)));
    view.appendChild(section.node);
    const rest = items.length - INLINE_ROWS;
    if (rest > 0 || state.nextCursor) {
      const more = d.overflowAction('Show all ' + countLabel(items.length, noun), state.listHref);
      const foot = d.footer([more]);
      if (foot) view.appendChild(foot);
    }
  }

  /**
   * The next page, fetched by calling list_work again with the cursor the last page returned. A
   * host that cannot run the call, or a page that fails, leaves the rest one link away in Docket.
   */
  function loadMore() {
    return d.button('Load more', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const result = await d.call('list_work', Object.assign({}, d.input, { cursor: state.nextCursor }));
        const page = result && result.structuredContent;
        if (!page || !Array.isArray(page.items)) throw new Error('empty page');
        state = Object.assign({}, state, { items: (state.items || []).concat(page.items), nextCursor: page.nextCursor });
        d.notice('');
        draw();
      } catch {
        button.disabled = false;
        d.notice('The next page could not be loaded. Open Docket to see the rest.', 'error');
      }
    }, { tonal: true });
  }

  d.onDisplayMode(draw);
  d.onData((data) => {
    state = data;
    draw();
  });
})();
`;

/** The rendered work-list document. */
export const WORK_LIST_HTML = appDocument('Work list', SCRIPT, { skeletonRows: 4 });
