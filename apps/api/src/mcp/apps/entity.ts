/**
 * `@docket/api` — semantic entity widgets.
 *
 * @remarks
 * One document per readable type, sharing the builders in `runtime-ui.ts` but never a generic
 * layout: a project leads with its brief and its work, an update with its writing, a session with
 * the work in motion. Every card is a header — kind, title, qualifying chips, its one action — and
 * then sections, each a tonal container of anchored rows or rendered prose. Nothing is text stacked
 * on text.
 *
 * Authored fields (a brief, a description, an update's body) arrive as stored Markdown in the
 * payload and as a block model in the result's `_meta` (see `entity-render.ts`). The card draws only
 * the block model; a host that drops `_meta` gets the summary and never raw Markdown.
 */
import { PROJECT_SCRIPT } from './project-card';
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

const SCRIPT = String.raw`
(() => {
  const d = window.docket;
  const P = window.docketProject;
  /**
   * Rows per section inline. A card sits in a conversation beside the model's answer, so inline it
   * is a glance: a few rows per section and a way into fullscreen, where every section shows all of
   * itself.
   */
  const INLINE_ROWS = 3;
  let items = [];
  let missing = [];
  let type = '';

  const PRIORITIES = ['urgent', 'high', 'medium', 'low', 'none'];

  const text = (value) => (value === null || value === undefined ? '' : String(value));
  const labelOf = (kind) => d.capital(d.noun(kind));
  const pluralOf = (kind) => d.noun(kind) + 's';
  const nameOf = (item) => text(item && (item.title || item.name || item.displayName));
  const day = (value) => (text(value) ? d.label(text(value).slice(0, 10)) : '');
  const plural = d.plural;

  /** The status a container carries, as its own words. */
  function statusChip(item) {
    const state = item.state || item.status;
    return state ? d.chip(d.label(state)) : null;
  }

  /** Show the whole card in fullscreen, where every section shows all of itself. */
  function expandAction() {
    if (d.fullscreen || !d.canDisplay('fullscreen')) return null;
    return d.iconOnly('expand', 'Show everything', () => void d.requestDisplayMode('fullscreen'));
  }

  /** Leave the card for the thing's own page: the one action a resource card offers. */
  function openAction(item) {
    if (!item.href) return null;
    const button = d.button('Open', () => d.link(item.href), { tonal: true, label: 'Open ' + (nameOf(item) || labelOf(type)) + ' in Docket' });
    const out = d.kindIcon('outward');
    if (out) button.appendChild(out);
    return button;
  }

  /** Rows in a section, capped inline; "Show all" opens fullscreen or Docket for the rest. */
  function listSection(label, rows, options) {
    if (!rows || rows.length === 0) return null;
    const total = (options && options.total) || rows.length;
    const inline = (options && options.inline) || INLINE_ROWS;
    const shown = d.fullscreen && total === rows.length ? rows : rows.slice(0, inline);
    const count = total > shown.length ? shown.length + ' of ' + total : String(total);
    let action = null;
    if (total > rows.length && options && options.href) action = d.button('Show all', () => d.link(options.href));
    else if (total > shown.length) action = d.overflowAction('Show all', options && options.href);
    const section = d.section({ label, count, action });
    for (const row of shown) section.body.appendChild(d.row(row));
    return section.node;
  }

  /** Authored prose in its own section, clamped inline with a way to read the rest. */
  function proseSection(label, rich, options) {
    if (!rich || rich.blocks.length === 0) return null;
    const section = d.section({ label });
    section.body.appendChild(d.clamped(rich, options));
    return section.node;
  }

  /** A related task on one line: its glyph, its title, and its state in the team's words. */
  function taskRow(task) {
    return {
      anchor: d.stateGlyph(task.stateType) || d.kindIcon('task'),
      title: task.title, kind: 'task',
      trailing: task.stateName || d.label(task.state),
      href: task.href,
    };
  }

  function refRow(kind, ref) {
    const anchor = d.kindIcon(kind);
    const tone = d.healthTone(ref.health);
    if (anchor && tone) anchor.classList.add('tone-' + tone);
    return {
      anchor, title: nameOf(ref), kind,
      meta: [ref.status && d.label(ref.status), ref.health && { text: d.label(ref.health), tone }],
      href: ref.href,
    };
  }

  /** What a container is for, in two lines: its summary, or the first paragraph of its brief. */
  function ledeOf(item) {
    const rich = d.rich(item.id, 'description');
    return text(item.summary) || (rich ? rich.excerpt : '');
  }

  function containerHeader(item, chips) {
    return d.header({
      kind: type, kicker: labelOf(type), title: nameOf(item) || d.untitled(type),
      chips: [statusChip(item), d.healthChip(item.health)].concat(chips || []),
      lede: ledeOf(item), actions: [expandAction(), openAction(item)],
    });
  }

  function brief(item) {
    return proseSection('Brief', d.rich(item.id, 'description'), { lines: 6, href: item.href });
  }

  /**
   * Inline, a project is a glance: what it is, how its work divides, and the latest word on it. In
   * fullscreen it is the whole record, with a Tasks view to browse every task.
   */
  function project(item) {
    const header = containerHeader(item, [item.targetDate && 'Target ' + day(item.targetDate), P.milestoneChip(item)]);
    if (!d.fullscreen) return [header, P.workSection(item, INLINE_ROWS), P.updateRow(item)];
    const tasks = P.view === 'tasks' ? P.browser(item) : null;
    if (tasks) return [header, P.viewTabs(item), ...tasks];
    return [
      header,
      P.viewTabs(item),
      brief(item),
      P.workSection(item, 5),
      P.milestoneSection(item),
      P.updatePost(item),
      listSection('Initiatives', (item.initiatives || []).map((ref) => refRow('initiative', ref))),
    ];
  }

  /** Inline, a program is its projects and the latest word on it; fullscreen adds the rest. */
  function program(item) {
    const rollup = item.rollup && plural(item.rollup.projects, 'project') + ' · ' + plural(item.rollup.tasks, 'task');
    const projects = listSection('Projects', (item.projects || []).map((ref) => refRow('project', ref)));
    if (!d.fullscreen) return [containerHeader(item, [rollup]), projects, P.updateRow(item)];
    return [
      containerHeader(item, [rollup]),
      brief(item),
      projects,
      P.updatePost(item),
      listSection('Initiatives', (item.initiatives || []).map((ref) => refRow('initiative', ref))),
    ];
  }

  /** A relation, said on the right of a one-line row. */
  function relation(text, late) {
    return d.el('span', late ? 'late' : '', text);
  }

  /**
   * What a task is tied to, in one list of one-line rows: what blocks it, what it blocks, and its
   * subtasks. The glyph carries each task's state; the right edge says how it relates.
   */
  function related(item) {
    const row = (task, how) => Object.assign(taskRow(task), { trailing: how });
    const rows = []
      .concat((item.blockedBy || []).map((task) => row(task, relation('Blocks this', true))))
      .concat((item.blocking || []).map((task) => row(task, relation('Waiting on this'))))
      .concat((item.subtasks || []).map((task) => row(task, relation('Subtask'))));
    return listSection('Related', rows);
  }

  function task(item) {
    const header = d.header({
      kind: 'task', kicker: labelOf('task'), title: nameOf(item) || d.untitled('task'),
      chips: Array.isArray(item.stateOptions) ? [] : [statusChip(item), item.dueDate && 'Due ' + day(item.dueDate)],
      actions: [expandAction(), openAction(item)],
    });
    const description = proseSection('Description', d.rich(item.id, 'description'), { lines: 3, href: item.href });
    if (!d.fullscreen) return [header, propertyBar(item), description, related(item)];
    return [
      header,
      properties(item),
      description,
      listSection('Blocked by', (item.blockedBy || []).map(taskRow)),
      listSection('Blocking', (item.blocking || []).map(taskRow)),
      listSection('Subtasks', (item.subtasks || []).map(taskRow)),
    ];
  }

  const SINGLE = {
    project,
    program,
    initiative: (item) => [
      containerHeader(item, [item.targetDate && 'Target ' + day(item.targetDate)]),
      d.fullscreen ? brief(item) : null,
      listSection('Projects', (item.projects || []).map((ref) => refRow('project', ref))),
      listSection('Programs', (item.programs || []).map((ref) => refRow('program', ref)), { inline: 2 }),
    ],
    task,
    cycle: (item) => [
      containerHeader(item, [item.startsAt && day(item.startsAt) + (item.endsAt ? ' – ' + day(item.endsAt) : '')]),
      listSection('Tasks', (item.tasks || []).map(taskRow)),
    ],
    team: (item) => [
      d.header({ kind: 'team', kicker: labelOf('team'), title: nameOf(item), lede: text(item.description), chips: [item.triageEnabled ? 'Triage on' : ''] }),
      listSection('People', (item.members || []).map((member) => ({ anchor: d.kindIcon('team'), title: nameOf(member) }))),
      listSection('Workflow', (item.workflowStates || []).map((state) => ({ anchor: d.stateGlyph(state.type), title: state.name || state.key }))),
    ],
    update: (item) => writing(item, 'update', [d.healthChip(item.health)]),
    comment: (item) => writing(item, 'comment', [item.editedAt && 'Edited ' + day(item.editedAt)]),
    session: (item) => [
      d.header({
        kind: 'session', kicker: labelOf('session'), title: text(item.task && item.task.title) || 'Agent session',
        chips: [statusChip(item), text(item.agent && item.agent.displayName), item.trigger && d.label(item.trigger), item.startedAt && 'Started ' + day(item.startedAt)],
        actions: [openAction(item)],
      }),
      listSection('Recent activity', (item.activities || []).slice().reverse().map((activity) => ({
        anchor: d.kindIcon('session'), title: d.label(activity.type), note: text(activity.body && activity.body.text),
      }))),
    ],
    agent: (item) => [
      d.header({ kind: 'agent', kicker: labelOf('agent'), title: nameOf(item), chips: [item.approvalPolicy && d.label(item.approvalPolicy), item.connection && item.connection.protocol && d.label(item.connection.protocol)], actions: [openAction(item)] }),
      proseSection('Guidance', d.rich(item.id, 'guidance'), { lines: 4, href: item.href }),
    ],
    view: (item) => [
      d.header({ kind: 'view', kicker: labelOf('view'), title: nameOf(item), chips: [item.scope && d.label(item.scope), item.grouping && 'Grouped by ' + d.label(item.grouping)], actions: [openAction(item)] }),
    ],
    org: (item) => [
      d.header({ kind: 'org', kicker: labelOf('org'), title: nameOf(item), chips: item.counts ? [plural(item.counts.teams, 'team'), plural(item.counts.projects, 'project'), plural(item.counts.programs, 'program')] : [], actions: [openAction(item)] }),
    ],
  };

  /** An update or comment: named after what it is about, its writing as the body. */
  function writing(item, kind, extra) {
    const subject = item.subject || {};
    const by = text(item.author && item.author.displayName);
    return [
      d.header({
        kind, kicker: labelOf(kind) + (subject.type ? ' on ' + labelOf(subject.type).toLowerCase() : ''),
        title: text(subject.name) || labelOf(kind),
        chips: [by, day(item.createdAt)].concat(extra),
        actions: [expandAction(), openAction(subject.href ? subject : item)],
      }),
      proseSection('', d.rich(item.id, 'body'), { lines: 8, href: item.href }),
    ];
  }

  /** The task's own fields, each a working editor. */
  /** The task's three editable fields, each as [icon, label, control]. */
  function editors(item) {
    const state = select(item.stateOptions.map((o) => [o.key, o.name]), item.state, 'State', (value, control) =>
      save(control, 'state', value, item.state, () => {
        const chosen = item.stateOptions.find((o) => o.key === value);
        item.stateType = chosen ? chosen.type : undefined;
        draw();
      }));
    const due = d.el('input');
    due.type = 'date';
    due.setAttribute('aria-label', 'Due');
    due.value = item.dueDate ? String(item.dueDate).slice(0, 10) : '';
    due.addEventListener('change', () => save(due, 'dueDate', due.value || null, item.dueDate ? String(item.dueDate).slice(0, 10) : ''));
    const priority = select(PRIORITIES.map((p) => [p, p === 'none' ? 'No priority' : d.label(p)]), item.priority || 'none', 'Priority', (value, control) =>
      save(control, 'priority', value, item.priority || 'none', () => draw()));
    return [
      [d.stateGlyph(item.stateType), 'State', state],
      [d.kindIcon('due'), 'Due', due],
      [d.priorityGlyph(item.priority), 'Priority', priority],
    ];
  }

  /** Inline: the editable fields as one row of compact editors, each led by its icon. */
  function propertyBar(item) {
    if (!Array.isArray(item.stateOptions)) return null;
    const bar = d.el('div', 'props-bar');
    for (const [icon, , control] of editors(item)) {
      const pill = d.el('label', 'prop-pill');
      if (icon) pill.appendChild(icon);
      pill.appendChild(control);
      bar.appendChild(pill);
    }
    return bar;
  }

  /** Fullscreen: the same editors as labelled rows. */
  function properties(item) {
    if (!Array.isArray(item.stateOptions)) return null;
    const section = d.section({ label: 'Properties' });
    for (const [icon, label, control] of editors(item)) section.body.appendChild(property(anchorOf(icon), label, control));
    return section.node;
  }

  function anchorOf(node) {
    const anchor = d.el('span', 'row-anchor');
    if (node) anchor.appendChild(node);
    return anchor;
  }

  function property(anchor, label, control) {
    const row = d.el('label', 'prop');
    row.appendChild(anchor);
    row.appendChild(d.el('span', 'prop-label', label));
    const box = d.el('span', 'prop-control');
    box.appendChild(control);
    row.appendChild(box);
    return row;
  }

  function select(options, current, label, onChange) {
    const control = d.el('select');
    control.setAttribute('aria-label', label);
    for (const [value, name] of options) {
      const option = d.el('option', '', name);
      option.value = value;
      option.selected = value === current;
      control.appendChild(option);
    }
    control.addEventListener('change', () => onChange(control.value, control));
    return control;
  }

  async function save(control, field, value, previous, after) {
    const item = items[0];
    control.disabled = true;
    try {
      await d.call('update', { orgId: d.input.orgId, entity: 'task', scope: { ids: [item.id] }, set: { [field]: value } });
      item[field] = value;
      d.notice('');
      if (after) after();
    } catch {
      control.value = previous;
      d.notice('That could not be saved. Open Docket to check it.', 'error');
    } finally {
      control.disabled = false;
    }
  }

  function batchRow(item) {
    const row = refRow(type, item);
    const counts = [];
    if (typeof item.taskCount === 'number') counts.push(plural(item.taskCount, 'task'));
    if (item.rollup) counts.push(plural(item.rollup.projects, 'project'));
    if (item.childMix) counts.push(plural(item.childMix.projects, 'project'));
    const rich = d.rich(item.id, 'description') || d.rich(item.id, 'body');
    return Object.assign(row, {
      meta: row.meta.concat(counts),
      note: text(item.summary) || (rich ? rich.excerpt : ''),
      title: nameOf(item) || text(item.subject && item.subject.name) || d.untitled(type),
    });
  }

  /** A batch is one list under the header that already names and counts it. */
  function batchSection(list) {
    // A batch is the whole card, so it can hold more rows than a section among others.
    const shown = d.fullscreen ? list : list.slice(0, 5);
    const more = list.length > shown.length ? d.overflowAction('Show all') : null;
    const section = d.section({ label: more ? shown.length + ' of ' + list.length : '', action: more });
    for (const item of shown) section.body.appendChild(d.row(batchRow(item)));
    return section.node;
  }

  function draw() {
    const view = d.canvas();
    if (items.length === 0) {
      view.appendChild(d.header({ kind: type, title: 'Nothing found' }));
    } else if (items.length === 1) {
      const build = d.own(SINGLE, type);
      const parts = build ? build(items[0]) : [d.header({ kind: type, kicker: labelOf(type), title: nameOf(items[0]) })];
      for (const part of parts) if (part) view.appendChild(part);
    } else {
      view.appendChild(d.header({ kind: type, title: plural(items.length, labelOf(type).toLowerCase()) }));
      view.appendChild(batchSection(items));
    }
    if (missing.length > 0) view.appendChild(d.el('p', 'empty', plural(missing.length, 'item') + ' could not be found'));
  }

  P.setRedraw(() => draw());
  d.onDisplayMode((mode) => {
    P.onMode(mode);
    if (items.length > 0 || missing.length > 0) draw();
  });
  d.onData((data) => {
    type = entityType || d.input.type || type;
    items = Array.isArray(data.items) ? data.items : [];
    missing = Array.isArray(data.missing) ? data.missing : [];
    draw();
  });
})();`;

/** Build the legacy generic entity document or a document dedicated to one readable entity type. */
export function entityDocument(entityType?: EntityDocumentType): string {
  const script = `${PROJECT_SCRIPT}\nconst entityType = ${JSON.stringify(entityType ?? null)};\n${SCRIPT}`;
  return appDocument(entityType ? `${entityType} details` : 'Entity', script, { skeletonRows: 3 });
}

/** The generic document retained for direct callers of the legacy `get` tool. */
export const ENTITY_HTML = entityDocument();
