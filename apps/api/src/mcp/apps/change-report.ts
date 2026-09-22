/**
 * `@docket/api` — the change-report widget.
 *
 * @remarks
 * This surface executes writes immediately instead of proposing them, so this card is the only
 * place a person sees what actually happened. It shows **diffs, not end states** — "Priority: High →
 * Low" rather than "Priority: Low", because only the first is checkable — and gives what was left
 * alone its own section, because a bulk write routinely half-succeeds and prose buries that half.
 *
 * One card serves `capture`, `update`, `archive`, `organize`, `plan_commit`, `define_labels`, and
 * `define_template`. It reports an event,
 * so it is built as a receipt rather than a resource card:
 * - a status glyph and a one-line summary of what happened, with a chip for where it landed;
 * - a section of rows anchored by what was done to each (added, edited, archived);
 * - a section for what was left alone;
 * - Undo in a footer, under what it would take back.
 *
 * A filed plan is a tree, so its card shows the top level with each item's child count inline and
 * the whole tree in fullscreen. Printing thirty rows at equal weight hides the shape the reader
 * needs to check.
 *
 * Field values arrive in `structuredContent` as the model reads them. The result's `_meta` carries
 * how a person should read them (see `change-render.ts`): names instead of ids, a state change as one
 * field instead of three, and a rewrite of long text as the words that changed.
 */
import { appDocument } from './runtime';

const SCRIPT = String.raw`
(() => {
  const d = window.docket;
  /**
   * How much a receipt shows inline. It sits in a conversation beside the model's own account of
   * the write, so it confirms and offers Undo; fullscreen shows every row and every field.
   */
  const INLINE_ROWS = 5;
  const INLINE_CHANGED = 3;
  const INLINE_SKIPPED = 2;
  const INLINE_FIELDS = 2;
  const INLINE_FIELDS_SINGLE = 4;
  let data = null;
  let undone = false;

  const VERB = {
    capture: 'Captured', update: 'Changed', archive: 'Archived', organize: 'Filed', plan_commit: 'Filed',
    define_labels: 'Saved', define_template: 'Saved',
  };
  const LEFT_ALONE = {
    capture: 'Not captured', update: 'Not changed', archive: 'Not archived', organize: 'Not filed',
    define_labels: 'Not saved', define_template: 'Not saved',
  };
  const NOTHING = {
    capture: 'Nothing captured', update: 'Nothing changed', archive: 'Nothing archived', organize: 'Nothing to file',
    plan_commit: 'Nothing to file', define_labels: 'Already set up', define_template: 'Already set up',
  };
  const REASON = {
    not_permitted: 'You cannot edit this one',
    already_archived: 'Already archived',
    not_archived: 'Was not archived',
    changed_since: 'Someone else changed it',
    gone: 'No longer exists',
    label_out_of_scope: 'A label belongs to another team',
    conflict: 'Clashes with an existing name or team',
    not_found: 'Names something that is not there',
    validation_error: 'The request was incomplete',
  };
  const FIELD_LABEL = {
    state: 'State', status: 'Status', statusId: 'Status', dueDate: 'Due', startDate: 'Start',
    targetDate: 'Target', priority: 'Priority', title: 'Title', name: 'Name', summary: 'Summary',
    description: 'Description', estimate: 'Estimate', assigneeId: 'Assignee', delegateId: 'Delegate',
    leadId: 'Lead', ownerId: 'Owner', projectId: 'Project', programId: 'Program',
    milestoneId: 'Milestone', cycleId: 'Cycle', parentTaskId: 'Parent', health: 'Health', labels: 'Labels',
    color: 'Color', groupId: 'Group', teamId: 'Team', exclusive: 'Pick', scope: 'Shared with',
    draftTitle: 'Starting title', draftName: 'Starting name', body: 'Body',
  };
  // Only wire enums and dates are reworded for reading, with the server's "none" for an unset value.
  // Anything else is text someone typed or a name the server resolved, and re-casing it misstates
  // it: "was Bug" for a label called "bug" hides a case-only rename.
  const REWORDED = {
    state: true, status: true, priority: true, health: true, scope: true, color: true, dueDate: true,
    startDate: true, targetDate: true, startDateResolution: true, targetDateResolution: true,
  };

  /** What each write did to a row, as the icon that anchors it. */
  const ACTION_ICON = { capture: 'added', update: 'edited', archive: 'archived', organize: 'added', plan_commit: 'added' };

  const tool = () => {
    const info = d.hostContext.toolInfo;
    return (info && info.tool && info.tool.name) || '';
  };
  const { plural, capital, noun: nounOf } = d;
  const fieldLabel = (field) =>
    d.own(FIELD_LABEL, field) || capital(String(field).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase());
  const blank = (value) => value === null || value === undefined || value === '' || value === 'none';
  const valueLabel = (field, value) => (d.own(REWORDED, field) ? d.label(value) : String(value));

  /** How a person should read one field, from the render model when the server sent one. */
  function fieldRender(itemId, field) {
    const changes = d.renderModel().changes;
    const fields = changes && d.own(changes, itemId);
    return (fields && d.own(fields, field.field)) || {};
  }

  function rewriteValue(rewrite) {
    const dd = d.el('dd');
    const counts = [];
    if (rewrite.wordsAdded) counts.push('+' + rewrite.wordsAdded);
    if (rewrite.wordsRemoved) counts.push('−' + rewrite.wordsRemoved);
    dd.appendChild(d.el('span', 'now', 'Rewritten'));
    if (counts.length > 0) dd.appendChild(d.el('span', 'excerpt', counts.join(' ') + ' words'));
    const excerpt = d.el('div', 'excerpt full');
    if (rewrite.lead) excerpt.appendChild(document.createTextNode((rewrite.leadCut ? '…' : '') + rewrite.lead + ' '));
    if (rewrite.removed) excerpt.appendChild(d.el('del', '', rewrite.removed));
    if (rewrite.removed && rewrite.inserted) excerpt.appendChild(document.createTextNode(' '));
    if (rewrite.inserted) excerpt.appendChild(d.el('ins', '', rewrite.inserted));
    if (rewrite.tail) excerpt.appendChild(document.createTextNode(' ' + rewrite.tail + (rewrite.tailCut ? '…' : '')));
    dd.appendChild(excerpt);
    return dd;
  }

  /** Writing a card never prints whole: it is Markdown, and it can run to pages. */
  const LONG_TEXT = { description: true, summary: true, body: true };

  /** One field's value: was → now, or only "was" for a rename, whose new name heads the row. */
  function changeValue(field, render) {
    if (render.rewrite) return rewriteValue(render.rewrite);
    const dd = d.el('dd');
    if (d.own(LONG_TEXT, field.field) && render.to === undefined) {
      dd.appendChild(d.el('span', 'now', blank(field.to) ? 'Removed' : 'Rewritten'));
      return dd;
    }
    const from = render.from !== undefined ? render.from : field.from;
    const to = render.to !== undefined ? render.to : field.to;
    if (field.field === 'title' || field.field === 'name') {
      dd.append('was ', d.el('span', 'was', from));
      return dd;
    }
    if (!blank(from)) dd.append(d.el('span', 'was', valueLabel(field.field, from)), '→');
    dd.appendChild(d.el('span', 'now', blank(to) ? 'None' : valueLabel(field.field, to)));
    return dd;
  }

  /** The fields that changed on one row, up to limit inline, then how many more there are. */
  function changeList(item, limit) {
    const list = d.el('dl', 'changes');
    const fields = visibleFields(item);
    const shown = d.fullscreen ? fields : fields.slice(0, limit);
    for (const field of shown) {
      list.appendChild(d.el('dt', '', fieldLabel(field.field)));
      list.appendChild(changeValue(field, fieldRender(item.id, field)));
    }
    if (fields.length > shown.length) {
      list.appendChild(d.el('dt', ''));
      list.appendChild(d.el('dd', 'excerpt', plural(fields.length - shown.length, 'more field')));
    }
    return list.childElementCount > 0 ? list : null;
  }

  function undoFooter() {
    if (!data.changeSetId || undone) return null;
    return d.footer([d.iconButton('undo', 'Undo', undo, { tonal: true })]);
  }

  /**
   * A filed row's anchor: the arrow that says it sits under the row above, the mark that says it
   * was added, or its own kind when it was already there.
   */
  function treeAnchor(node, depth) {
    if (depth > 0) return 'child';
    return node.created === false ? node.kind : 'added';
  }

  /** What one node's children are called: a task's are subtasks, anything else's are their kind. */
  function childNoun(node, kids) {
    if (node.kind === 'task') return 'subtask';
    return nounOf(kids[0] && kids[0].kind);
  }

  /** Fields a person reads on a row, after folding the ones that ride along with another. */
  function visibleFields(item) {
    return (item.fields || []).filter((field) => !fieldRender(item.id, field).hidden);
  }

  /** A count of kinds, said as a list: "1 project and 3 tasks". */
  function countsPhrase(counts) {
    const parts = counts.filter(([count]) => count > 0).map(([count, noun]) => plural(count, noun));
    if (parts.length <= 1) return parts.join('');
    return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
  }

  /** The receipt's status: everything done, some left alone, or nothing at all. */
  function statusOf(changed, skipped) {
    if (changed === 0) return 'none';
    return skipped > 0 ? 'partial' : 'done';
  }

  /** The one-line summary of a flat write. */
  function flatSummary(verb, count, single, kind, rows) {
    if (count === 0) return d.own(NOTHING, tool()) || 'Nothing changed';
    if (single && tool() === 'update') {
      const fields = visibleFields(single).length;
      return fields > 0 ? verb + ' ' + plural(fields, 'field') : verb;
    }
    return verb + ' ' + (kind ? plural(count, nounOf(kind)) : kindsPhrase(rows));
  }

  /**
   * What a flat report's rows are. update and archive name one entity; capture names none and only
   * makes tasks; a catalog tool names each row's kind, and one define_labels call can mix labels and
   * label groups, which reads as '' here.
   */
  function kindOf(rows) {
    if (data.entity) return data.entity;
    const kinds = new Set(rows.map((row) => row.kind).filter(Boolean));
    if (kinds.size === 0) return 'task';
    return kinds.size === 1 ? [...kinds][0] : '';
  }

  /** "1 label group and 2 labels": each kind's count, in the order the rows name them. */
  function kindsPhrase(rows) {
    const kinds = [...new Set(rows.map((row) => row.kind))];
    return countsPhrase(kinds.map((kind) => [rows.filter((row) => row.kind === kind).length, nounOf(kind)]));
  }

  /** The flat reports: capture, update, archive. */
  function flat() {
    const rows = data.changes || data.items || [];
    const skipped = data.skipped || [];
    const kind = kindOf(rows);
    const verb = d.own(VERB, tool()) || 'Changed';
    const count = typeof data.changed === 'number' ? data.changed : rows.length;
    const single = rows.length === 1 ? rows[0] : null;
    const view = d.canvas();
    view.appendChild(d.receipt({
      status: statusOf(count, skipped.length),
      summary: flatSummary(verb, count, single, kind, rows),
      place: single ? { kind: kind || single.kind, title: single.title || d.untitled(kind), href: single.href } : null,
      detail: skipped.length > 0 ? plural(skipped.length, nounOf(kindOf(skipped))) + ' left alone' : '',
    }));
    const list = single ? changeList(single, INLINE_FIELDS_SINGLE) : null;
    if (list) {
      const section = d.section({ label: 'Changes' });
      section.body.appendChild(list);
      view.appendChild(section.node);
    } else if (!single && rows.length > 0) {
      // A catalog row names its own kind, because one define_labels call mixes labels and groups,
      // and says where it lives, because two labels called Bug in different teams are one line.
      view.appendChild(rowSection(kind ? capital(nounOf(kind)) + 's' : 'Items', rows.map((item) => ({
        anchor: d.kindIcon(d.own(ACTION_ICON, tool()) || 'edited'), title: item.title, kind: item.kind || kind,
        href: item.href, meta: [item.note, item.matched && 'Already there'], extra: changeList(item, INLINE_FIELDS),
      })), data.listHref, INLINE_CHANGED));
    }
    if (skipped.length > 0) {
      view.appendChild(rowSection(d.own(LEFT_ALONE, tool()) || 'Not changed', skipped.map((item) => ({
        anchor: d.kindIcon('alert'), title: item.title, kind: item.kind || kind,
        trailing: d.el('span', 'reason', d.own(REASON, item.reason) || d.label(item.reason)),
      })), data.listHref, INLINE_SKIPPED));
    }
    const foot = undoFooter();
    if (foot) view.appendChild(foot);
  }

  function rowSection(label, rows, listHref, inline) {
    const shown = d.fullscreen ? rows : rows.slice(0, inline);
    const more = rows.length > shown.length ? d.overflowAction('Show all', listHref) : null;
    const section = d.section({ label, count: rows.length > shown.length ? shown.length + ' of ' + rows.length : rows.length, action: more });
    for (const row of shown) section.body.appendChild(d.row(row));
    return section.node;
  }

  /** The existing place every top-level item was filed into, when they share one. */
  function sharedContainer(roots) {
    const ids = new Set(roots.map((node) => node.container && node.container.id));
    return ids.size === 1 && roots[0] && roots[0].container ? roots[0].container : null;
  }

  /** "9 tasks and 17 subtasks", or each kind's count when a plan mixes kinds. */
  function planPhrase(placed, roots) {
    if (placed.every((node) => node.kind === 'task')) {
      return countsPhrase([[roots.length, 'task'], [placed.length - roots.length, 'subtask']]);
    }
    const kinds = ['initiative', 'program', 'project', 'task'];
    return countsPhrase(kinds.map((kind) => [placed.filter((node) => node.kind === kind).length, kind]));
  }

  /** The one-line summary of a filed plan. */
  function planSummary(placed, roots) {
    if (roots.length === 0) return d.own(NOTHING, tool()) || 'Nothing to file';
    return (d.own(VERB, tool()) || 'Filed') + ' ' + planPhrase(placed, roots);
  }

  /** A filed plan: what was filed and where, then the top level with child counts. */
  function tree() {
    const placed = data.placed;
    const children = new Map();
    for (const node of placed) {
      const key = node.parent || '';
      children.set(key, (children.get(key) || []).concat([node]));
    }
    const roots = children.get('') || [];
    const matched = placed.filter((node) => node.created === false).length;
    const container = sharedContainer(roots);
    const rootKind = roots.length > 0 && roots.every((node) => node.kind === roots[0].kind) ? roots[0].kind : '';
    const view = d.canvas();
    view.appendChild(d.receipt({
      status: roots.length === 0 ? 'none' : 'done',
      summary: planSummary(placed, roots),
      place: container,
      detail: matched > 0 ? String(matched) + ' already there' : '',
    }));
    if (roots.length === 0) return;
    const rows = [];
    const walk = (node, depth) => {
      const kids = children.get(node.ref) || [];
      rows.push({
        anchor: d.kindIcon(treeAnchor(node, depth)), title: node.title || d.untitled(node.kind), kind: node.kind,
        href: node.href, depth, dim: node.created === false,
        meta: [node.created === false && 'Already there', !d.fullscreen && kids.length > 0 && plural(kids.length, childNoun(node, kids))],
      });
      if (d.fullscreen) for (const kid of kids) walk(kid, depth + 1);
    };
    const shownRoots = d.fullscreen ? roots : roots.slice(0, INLINE_ROWS);
    for (const root of shownRoots) walk(root, 0);
    const hidden = !d.fullscreen && placed.length > shownRoots.length;
    const section = d.section({
      label: rootKind ? capital(nounOf(rootKind)) + 's' : 'Items',
      count: roots.length > shownRoots.length ? shownRoots.length + ' of ' + roots.length : roots.length,
      action: hidden ? d.overflowAction('Show all', container && container.href) : null,
    });
    for (const row of rows) section.body.appendChild(d.row(row));
    view.appendChild(section.node);
    const foot = undoFooter();
    if (foot) view.appendChild(foot);
  }

  function draw() {
    if (!data) return;
    if (undone) {
      d.canvas().appendChild(d.receipt({ status: 'undone', summary: 'Undone' }));
      return;
    }
    if (Array.isArray(data.placed)) tree();
    else flat();
  }

  async function undo(event) {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await d.call('undo', { orgId: d.input.orgId, changeSetId: data.changeSetId });
      undone = true;
      d.notice('');
      draw();
    } catch {
      // The rows stay: what could not be undone is exactly what the person needs to still see.
      d.notice('That could not be undone. Open Docket to check it.', 'error');
      button.disabled = false;
    }
  }

  d.onDisplayMode(draw);
  d.onData((next) => {
    data = next;
    draw();
  });
})();
`;

/** The rendered change-report document. */
export const CHANGE_REPORT_HTML = appDocument('Change report', SCRIPT, { skeletonRows: 2 });
