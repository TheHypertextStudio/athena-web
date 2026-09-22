/**
 * `@docket/api` — the parts of a project card that have to scale: its tasks, its milestones, and
 * what was last said about it.
 *
 * @remarks
 * A project can hold a hundred tasks. Inline, the card shows how its tasks divide across the
 * board's states as a row of counts, then the open tasks worth seeing first. Tapping a count, a
 * milestone, or "Browse all" opens the card fullscreen on its Tasks view. That view has state tabs, a
 * milestone filter, a search field, and every task grouped by state, drawn from the task index the
 * server sends in `_meta`. Milestones show their progress as a ring and their date relative to today,
 * and each opens the Tasks view filtered to its tasks. The latest update reads as a post: who wrote it,
 * when, how the project stands, then what they wrote on its own surface.
 *
 * Runs before the entity script and hands it `window.docketProject`.
 */
export const PROJECT_SCRIPT = String.raw`
(() => {
  const d = window.docket;
  const GROUPS = [['started', 'In progress'], ['unstarted', 'To do'], ['backlog', 'Backlog'], ['completed', 'Done'], ['canceled', 'Canceled']];
  const CLOSED = ['completed', 'canceled'];
  const view = { name: 'overview', filter: 'open', milestone: null, query: '', shown: {} };
  /** Rows per state group before "Show more": enough to scan, few enough to draw at once. */
  const PAGE = 25;
  let redraw = () => {};

  /** The project's browsable tasks from the render model, or null when the host sent none. */
  function indexOf(itemId) {
    const work = d.renderModel().work;
    const index = work && d.own(work, itemId);
    return index && Array.isArray(index.tasks) ? index : null;
  }

  function canBrowse(item) {
    return d.canDisplay('fullscreen') && indexOf(item.id) !== null;
  }

  /** Open the Tasks view, optionally already filtered. A host that keeps the card inline keeps the Overview next. */
  function browse(changes) {
    Object.assign(view, { name: 'tasks', filter: 'open', milestone: null, query: '', shown: {} }, changes);
    if (d.fullscreen) redraw();
    else void d.requestDisplayMode('fullscreen').then((mode) => { if (mode !== 'fullscreen') view.name = 'overview'; });
  }

  /** Due day as a fact, coloured when it has passed and the work is not done. */
  function dueFact(iso, closed) {
    const when = d.when(iso);
    if (!when) return null;
    return { text: when.late ? when.text : 'due ' + when.text, late: when.late && !closed };
  }

  /**
   * One task. In the mixed open-work list its state trails the row; in the browser, where the
   * group already names the state and a milestone filter already names the milestone, neither
   * repeats on every row.
   */
  function taskRow(task, milestones) {
    const due = dueFact(task.dueDate, CLOSED.includes(task.stateType));
    if (!milestones) {
      // The open-work list is one line a task: the glyph says its state, the right edge says when.
      return {
        anchor: d.stateGlyph(task.stateType) || d.kindIcon('task'),
        title: task.title, kind: 'task', href: task.href,
        trailing: due ? d.el('span', due.late ? 'late' : '', due.text) : task.stateName || '',
      };
    }
    const milestone = !view.milestone && task.milestoneId ? milestones.get(task.milestoneId) : '';
    return {
      anchor: d.stateGlyph(task.stateType) || d.kindIcon('task'),
      title: task.title, kind: 'task', href: task.href,
      meta: [due, task.assignee, milestone],
    };
  }

  /** How the tasks divide across the board's states; each count opens the Tasks view on it. */
  function breakdown(byType, onPick) {
    const node = d.el('div', 'breakdown');
    for (const [type, name] of GROUPS) {
      const count = byType[type] || 0;
      if (!count) continue;
      const chip = onPick
        ? d.button('', () => onPick(type), { label: 'Show ' + d.plural(count, 'task') + ' ' + name.toLowerCase() })
        : d.el('span');
      if (!onPick) chip.setAttribute('aria-label', String(count) + ' ' + name);
      chip.classList.add('chip');
      const glyph = d.stateGlyph(type);
      if (glyph) chip.appendChild(glyph);
      chip.appendChild(document.createTextNode(String(count)));
      chip.appendChild(d.el('span', 'chip-label', ' ' + name));
      chip.title = String(count) + ' ' + name;
      node.appendChild(chip);
    }
    return node;
  }

  /** Inline: how the tasks divide, then the open tasks worth seeing first, up to limit. */
  function workSection(item, limit) {
    const work = item.work;
    if (!work || work.total === 0) return null;
    const browsable = canBrowse(item);
    let action = null;
    if (browsable) action = d.button('Browse all', () => browse({}));
    else if (item.href) action = d.button('Open in Docket', () => d.link(item.href));
    const section = d.section({ label: 'Tasks', count: work.open + ' open', action });
    section.body.appendChild(breakdown(work.byType, browsable ? (type) => browse({ filter: type }) : null));
    for (const task of (item.tasks || []).slice(0, limit)) section.body.appendChild(d.row(taskRow(task)));
    return section.node;
  }

  /** The next milestone as a header chip: its progress ring, its name, and when it lands. */
  function milestoneChip(item) {
    const m = nextMilestone(item.milestones || []);
    if (!m) return null;
    const progress = m.progress || { completed: 0, total: 0 };
    const when = d.when(m.targetDate);
    const label = m.name + (when ? ' · ' + when.text : '');
    const chip = canBrowse(item) && progress.total > 0
      ? d.button('', () => browse({ milestone: m.id }), { label: 'Show the tasks in ' + m.name })
      : d.el('span');
    chip.classList.add('chip');
    chip.appendChild(d.progressRing(progress.completed, progress.total));
    chip.appendChild(document.createTextNode(label));
    return chip;
  }

  /** The latest update in one row: who, when, how it stands, and its first lines. */
  function updateRow(item) {
    const update = item.latestUpdate;
    const rich = d.rich(item.id, 'latestUpdate.body');
    if (!update || !rich) return null;
    const author = (update.author && update.author.displayName) || '';
    const tone = d.healthTone(update.health);
    const when = d.el('span', '');
    if (update.health) when.appendChild(d.el('span', tone ? 'tone-' + tone : '', d.label(update.health) + ' · '));
    when.appendChild(document.createTextNode(d.ago(update.createdAt)));
    const row = d.row({ anchor: d.avatar(author), title: author || 'Update', trailing: when, note: rich.excerpt });
    if (d.canDisplay('fullscreen')) {
      d.actionRow(row, 'Read the latest update', 'Read', () => { view.name = 'overview'; void d.requestDisplayMode('fullscreen'); });
    }
    const section = d.section({ label: 'Latest update' });
    section.body.appendChild(row);
    return section.node;
  }

  /** The nearest milestone still ahead and still unfinished; an overdue one is already marked late. */
  function nextMilestone(list) {
    const ahead = (m) => { const when = d.when(m.targetDate); return when && !when.late; };
    const open = list.filter((m) => ahead(m) && !(m.progress && m.progress.total > 0 && m.progress.completed >= m.progress.total));
    open.sort((a, b) => String(a.targetDate).localeCompare(String(b.targetDate)));
    return open[0] || null;
  }

  function milestoneTrailing(m, complete) {
    const when = d.when(m.targetDate);
    if (!when) return '';
    return d.el('span', when.late && !complete ? 'late' : '', when.text);
  }

  /** Milestones with their progress and date; each opens the Tasks view on its tasks. */
  function milestoneSection(item) {
    const list = item.milestones || [];
    if (list.length === 0) return null;
    const browsable = canBrowse(item);
    const next = nextMilestone(list);
    const section = d.section({ label: 'Milestones', count: list.length });
    for (const m of list) {
      const progress = m.progress || { completed: 0, total: 0 };
      const complete = progress.total > 0 && progress.completed >= progress.total;
      const ring = d.progressRing(progress.completed, progress.total);
      const when = d.when(m.targetDate);
      if (when && when.late && !complete) ring.classList.add('tone-danger');
      const row = d.row({
        anchor: ring,
        title: m.name,
        meta: [progress.total ? progress.completed + ' of ' + progress.total + ' done' : 'No tasks yet', m === next && { text: 'Next', tone: 'info' }],
        trailing: milestoneTrailing(m, complete),
      });
      if (browsable && progress.total > 0) {
        d.actionRow(row, 'Show the tasks in ' + m.name, 'Show tasks', () => browse({ milestone: m.id }));
      }
      section.body.appendChild(row);
    }
    return section.node;
  }

  /** The latest update as a post: who, when, how it stands, then what they wrote. */
  function updatePost(item) {
    const update = item.latestUpdate;
    const rich = d.rich(item.id, 'latestUpdate.body');
    if (!update || !rich || rich.blocks.length === 0) return null;
    const section = d.section({ label: 'Latest update' });
    const post = d.el('article', 'post');
    const head = d.el('div', 'post-head');
    const author = (update.author && update.author.displayName) || '';
    head.appendChild(d.avatar(author));
    if (author) head.appendChild(d.el('span', 'post-author', author));
    head.appendChild(d.el('span', 'post-when', d.ago(update.createdAt)));
    const health = d.healthChip(update.health);
    if (health) head.appendChild(health);
    post.appendChild(head);
    post.appendChild(d.clamped(rich, { lines: 5, href: update.href || item.href, more: 'Read the full update' }));
    section.body.appendChild(post);
    return section.node;
  }

  /** Overview or Tasks, in fullscreen. */
  function viewTabs(item) {
    const index = indexOf(item.id);
    if (!d.fullscreen || !index) return null;
    return d.tabs(
      [{ value: 'overview', label: 'Overview' }, { value: 'tasks', label: 'Tasks', count: index.total }],
      view.name,
      (name) => { view.name = name; redraw(); },
      'Project view',
      true,
    );
  }

  function matches(task, milestoneNames) {
    if (view.milestone && task.milestoneId !== view.milestone) return false;
    const query = view.query.trim().toLowerCase();
    if (!query) return true;
    const haystack = [task.title, task.assignee, milestoneNames.get(task.milestoneId)].join(' ').toLowerCase();
    return haystack.includes(query);
  }

  function inFilter(task) {
    if (view.filter === 'open') return !CLOSED.includes(task.stateType);
    if (view.filter === 'done') return CLOSED.includes(task.stateType);
    return task.stateType === view.filter;
  }

  function filterTabs(tasks) {
    const count = (test) => tasks.filter(test).length;
    const options = [{ value: 'open', label: 'Open', count: count((t) => !CLOSED.includes(t.stateType)) }];
    for (const [type, name] of GROUPS.slice(0, 3)) {
      const n = count((t) => t.stateType === type);
      if (n > 0) options.push({ value: type, label: name, count: n });
    }
    const done = count((t) => CLOSED.includes(t.stateType));
    if (done > 0) options.push({ value: 'done', label: 'Done', count: done });
    return d.tabs(options, view.filter, (filter) => { view.filter = filter; redraw(); }, 'Filter tasks');
  }

  /** One state group, a page at a time, with a way to show the next page. */
  function groupSection(type, name, tasks, milestoneNames, onMore) {
    const limit = view.shown[type] || PAGE;
    const page = tasks.slice(0, limit);
    const rest = tasks.length - page.length;
    const more = rest > 0 ? d.button('Show ' + Math.min(rest, PAGE) + ' more', () => onMore(type, limit + PAGE)) : null;
    const section = d.section({ label: name, count: rest > 0 ? page.length + ' of ' + tasks.length : tasks.length });
    for (const task of page) section.body.appendChild(d.row(taskRow(task, milestoneNames)));
    if (more) {
      const foot = d.el('div', 'section-foot');
      foot.appendChild(more);
      section.node.appendChild(foot);
    }
    return section.node;
  }

  /** The grouped task sections for the current filter, milestone, and search. */
  function groups(index, milestoneNames, onMore) {
    const scoped = index.tasks.filter((task) => matches(task, milestoneNames));
    const shown = scoped.filter(inFilter);
    const nodes = [];
    for (const [type, name] of GROUPS) {
      const inGroup = shown.filter((task) => task.stateType === type);
      if (inGroup.length > 0) nodes.push(groupSection(type, name, inGroup, milestoneNames, onMore));
    }
    const loose = shown.filter((task) => !GROUPS.some(([type]) => type === task.stateType));
    if (loose.length > 0) {
      const section = d.section({ label: 'State not recognised', count: loose.length });
      for (const task of loose) section.body.appendChild(d.row(taskRow(task, milestoneNames)));
      nodes.push(section.node);
    }
    if (nodes.length === 0) nodes.push(d.el('p', 'empty', 'No tasks match'));
    return { nodes, scoped };
  }

  /**
   * The Tasks view: filter tabs, a milestone chip when one is on, search, then every task. Null when
   * this result carries no task index, and the card falls back to the Overview.
   */
  function browser(item) {
    const index = indexOf(item.id);
    if (!index) {
      view.name = 'overview';
      return null;
    }
    const milestoneNames = new Map((item.milestones || []).map((m) => [m.id, m.name]));
    const controls = d.el('div', 'browse-controls');
    const tabsHolder = d.el('div', 'tabs-holder');
    const list = d.el('div', 'content');
    // Typing redraws the tabs and the list but never the search field, so it keeps focus.
    const draw = () => {
      const result = groups(index, milestoneNames, (type, next) => { view.shown[type] = next; draw(); d.resize(); });
      list.replaceChildren(...result.nodes);
      tabsHolder.replaceChildren(filterTabs(result.scoped));
    };
    controls.appendChild(tabsHolder);
    if (view.milestone) controls.appendChild(d.filterChip('milestone', milestoneNames.get(view.milestone) || 'Milestone', () => { view.milestone = null; redraw(); }));
    controls.appendChild(d.search('Search tasks', view.query, (query) => { view.query = query; draw(); d.resize(); }));
    draw();
    const parts = [controls, list];
    if (index.total > index.tasks.length) {
      const note = d.el('div', 'card-foot');
      note.appendChild(d.el('span', 'note', 'Showing ' + index.tasks.length + ' of ' + index.total));
      if (item.href) note.appendChild(d.button('Open in Docket', () => d.link(item.href)));
      parts.push(note);
    }
    return parts;
  }

  window.docketProject = {
    get view() { return view.name; },
    workSection, milestoneSection, milestoneChip, updatePost, updateRow, viewTabs, browser,
    setRedraw(fn) { redraw = fn; },
    onMode(mode) { if (mode !== 'fullscreen') view.name = 'overview'; },
  };
})();
`;
