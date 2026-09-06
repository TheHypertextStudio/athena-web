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
 * specific set, and the card is the only place that set is visible.
 */
import { appDocument } from './runtime';

/** The widget's markup: a headline, the diff rows, what was skipped, and two actions. */
const BODY = `
<div class="headline" id="headline" aria-live="polite"></div>
<div class="rows" id="rows"></div>
<div class="group-label" id="skipped-label" hidden></div>
<div class="rows skipped" id="skipped"></div>
<button id="rest" class="rest quiet" hidden></button>
<div class="actions">
  <button id="undo" hidden>Undo</button>
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
      window.docket.own(FIELD_LABEL, field) ||
      String(field).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())
    );
  }

  const valueLabel = (value) => window.docket.label(value);

  function text(node, value) { node.textContent = value; }

  function untitled(item) {
    return window.docket.untitled(item.kind);
  }

  function diffRow(item) {
    const row = document.createElement('div');
    row.className = 'row';
    // Depth, when the payload carries a tree. The indent is what makes "a project under this
    // initiative, three tasks under that project" checkable at a glance, which is the only reason
    // a caller reaches for a tool that writes a whole plan in one call.
    if (item.depth) {
      row.style.paddingLeft = String(item.depth * 18) + 'px';
    }
    if (item.matched) {
      row.className = 'row matched';
    }
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = item.title || untitled(item);
    name.title = item.title || untitled(item);
    row.appendChild(name);
    const fields = item.fields || [];
    if (item.matched) {
      // The tool's whole promise is that running the same plan twice does not duplicate it. This
      // line is that promise, kept where the person can see it kept.
      const already = document.createElement('div');
      already.className = 'facts';
      already.textContent = 'already there';
      row.appendChild(already);
    }
    if (item.id && item.kind) {
      const open = document.createElement('button');
      open.className = 'quiet open';
      open.textContent = 'Open';
      open.setAttribute('aria-label', 'Open ' + (item.title || untitled(item)) + ' in Docket');
      open.addEventListener('click', () => openItem(item));
      row.appendChild(open);
    }
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
        more.className = 'muted more';
        more.textContent = ' +' + String(fields.length - 1);
        d.appendChild(more);
      }
      row.appendChild(d);
    }
    return row;
  }

  function openItem(item) {
    // The org comes from the arguments the tool was called with, over ui/notifications/tool-input.
    // A host that sends none leaves nothing to build a URL from, and a button that answers a click
    // with silence is worse than one that says why.
    const orgId = window.docket.input.orgId;
    if (!orgId || !item.id) {
      window.docket.notice('This host did not pass the workspace through, so there is nowhere to open.', 'error');
      return;
    }
    // Organize places four kinds in one call, so the row's own kind picks the section rather than
    // every link landing on /tasks/ and 404ing for a project.
    window.docket.link('/orgs/' + orgId + '/' + (item.kind || 'task') + 's/' + item.id);
  }

  function skippedRow(item) {
    const row = document.createElement('div');
    row.className = 'row';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = item.title || untitled(item);
    name.title = item.title || untitled(item);
    const reason = document.createElement('span');
    reason.className = 'reason';
    // Spelled out, because "not_permitted" is a wire value, not something to show a person.
    reason.textContent =
      window.docket.own(
        {
          not_permitted: 'you cannot edit this one',
          already_archived: 'already archived',
          not_archived: 'was not archived',
          changed_since: 'someone else changed it',
          gone: 'no longer exists',
        },
        item.reason,
      ) || item.reason;
    row.append(name, reason);
    return row;
  }

  function headlineFor(data) {
    const tool = toolName();
    const verb = window.docket.own(VERB, tool) || 'Changed';

    if (typeof data.changed === 'number') {
      const n = data.changed;
      if (n === 0) {
        return window.docket.own(NOTHING, tool) || 'Nothing changed';
      }
      return verb + ' ' + n + ' ' + (n === 1 ? 'item' : 'items');
    }
    if (typeof data.created === 'number') {
      // A plan is named by what it built, not by how many nodes it took. "Filed 4, matched 1
      // already there" is a tally of the API call; the person who asked for a Q3 initiative wants
      // to read the words "Q3 transit access" back.
      const roots = (data.placed || []).filter((p) => !p.parent);
      if (roots.length === 1 && roots[0] && roots[0].title) {
        return verb + ' “' + roots[0].title + '”';
      }
      if (roots.length > 1) {
        return verb + ' ' + roots.map((r) => '“' + (r.title || r.ref) + '”').join(', ');
      }
      return window.docket.own(NOTHING, tool) || 'Nothing to do';
    }
    if (data.title) {
      return verb + ' “' + data.title + '”';
    }
    return 'Done';
  }

  /**
   * Flatten what \`organize\` placed back into the shape it was written as: a tree.
   *
   * \`ref\` is the handle the model invented so a child could name its parent inside one call. It is
   * not a name — rendering it is how this card came to show rows reading "t-date" — but it is
   * exactly the pointer needed to rebuild the nesting, which is the one thing a caller of this tool
   * has to check and the one thing a flat list destroys.
   *
   * Matched rows stay in, dimmed. They are the evidence that a second run of the same plan
   * reconciled instead of duplicating, and dropping them makes an idempotent call look like it did
   * less than it did.
   */
  function treeOf(placed) {
    const children = new Map();
    for (const node of placed) {
      const key = node.parent || '';
      const bucket = children.get(key);
      if (bucket) {
        bucket.push(node);
      } else {
        children.set(key, [node]);
      }
    }
    const rows = [];
    const walk = (parentRef, depth) => {
      // Depth is capped rather than unbounded: past three levels the indent eats the title, and
      // \`organize\` cannot nest deeper than initiative → program → project → task anyway.
      for (const node of children.get(parentRef) || []) {
        rows.push({
          id: node.id,
          title: node.title || node.ref,
          kind: node.kind,
          matched: node.created === false,
          depth: Math.min(depth, 3),
          fields: [],
        });
        walk(node.ref, depth + 1);
      }
    };
    // A single root is already named in the headline, so the tree starts under it rather than
    // printing it twice — the card said “Filed “Q3 transit access”” and then, immediately below,
    // “Q3 transit access”.
    const roots = placed.filter((node) => !node.parent);
    const only = roots.length === 1 ? roots[0] : null;
    walk(only ? only.ref : '', 0);
    return rows;
  }

  // Every source names its own kind somewhere — \`update\`/\`archive\` scope the whole call to one
  // \`entity\`, \`organize\` tags each placed node with its \`kind\`, and \`capture\` only ever makes a
  // task — so every row below carries a real \`kind\` rather than leaving the title's fallback to
  // guess.
  function itemsOf(data) {
    if (Array.isArray(data.changes)) {
      return data.changes.map((c) => ({ ...c, kind: data.entity }));
    }
    if (Array.isArray(data.items)) {
      return data.items.map((i) => ({ ...i, kind: data.entity }));
    }
    if (Array.isArray(data.placed)) {
      return treeOf(data.placed);
    }
    if (data.id) {
      return [{ id: data.id, title: data.title, fields: [], kind: 'task' }];
    }
    return [];
  }

  function render(data) {
    state = data;
    text(el('headline'), headlineFor(data));

    const rows = el('rows');
    rows.replaceChildren();
    // Indentation is the structure in a plan, and a full-width rule across every level fights it —
    // five separated rows rather than one tree. A flat change list has no structure of its own, so
    // it keeps the rules.
    rows.className = Array.isArray(data.placed) ? 'rows tree' : 'rows';
    const items = itemsOf(data);
    // A tree truncated mid-branch is a lie about the shape, so a plan is shown whole. A flat
    // change list still folds, because row five of a bulk edit says nothing rows one to four did
    // not.
    const shown = Array.isArray(data.placed) ? items : items.slice(0, INLINE_ROWS);
    for (const item of shown) {
      rows.appendChild(diffRow(item));
    }
    const rest = el('rest');
    rest.hidden = shown.length === items.length;
    rest.textContent = 'Open in Docket to see ' + String(items.length - shown.length) + ' more';

    // \`skipped\` only ever comes from \`update\`/\`archive\`, both scoped to one \`entity\` — same
    // reasoning as \`itemsOf\` above.
    const left = (data.skipped || []).map((s) => ({ ...s, kind: data.entity }));
    const skipped = el('skipped');
    skipped.replaceChildren();
    for (const item of left) {
      skipped.appendChild(skippedRow(item));
    }
    // A bulk write routinely half-succeeds. Without a heading the untouched half reads as more of
    // the same list, which is the one reading that makes the card actively misleading.
    const skippedLabel = el('skipped-label');
    skippedLabel.hidden = left.length === 0;
    // The heading names what the rows under it are; counting them says nothing the rows do not,
    // since every one of them is on screen.
    skippedLabel.textContent =
      left.length === 0 ? '' : window.docket.own(LEFT_ALONE, toolName()) || 'Not changed';

    el('undo').hidden = !data.changeSetId;
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
    } catch {
      // The message stays beside the rows rather than replacing them: what could not be undone is
      // exactly the thing the person needs to still be looking at.
      window.docket.notice('That could not be undone. Open Docket to check it.', 'error');
      button.disabled = false;
    }
  });

  el('rest').addEventListener('click', () => {
    const first = (state ? itemsOf(state) : [])[0];
    if (first) openItem(first);
  });

  window.docket.onData(render);
})();
`;

/** The rendered change-report document. */
export const CHANGE_REPORT_HTML = appDocument('Change report', BODY, SCRIPT, { skeletonRows: 2 });
