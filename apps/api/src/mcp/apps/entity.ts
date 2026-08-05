/**
 * `@docket/api` — the entity widget.
 *
 * @remarks
 * One piece of work, shown where it was mentioned. The value over prose is not density — it is
 * that state and assignee are *current*: a transcript records what was true when the sentence was
 * written, and this reads the row.
 *
 * It shows where the item came from when a tool made it. "Created by Claude, from a conversation"
 * is the question people ask first about work that appeared without them typing it, and the change
 * set already knows the answer — authorship is recorded on its own axis rather than smuggled into
 * `provenance`, which means whether the row is mirrored from an external system.
 *
 * It takes the two edits a person makes *while looking at the card* — moving the state and setting
 * a due date — and nothing else. Everything else about a task is a sentence, and a card that grew
 * a form would be competing with the conversation it is sitting inside.
 *
 * The state options come from the payload, never from this file. Workflow states are per-team and
 * renameable, so a card that offered a hardcoded `done` would silently write nothing on a team
 * whose completed state is called `shipped`.
 */
import { appDocument } from './runtime';

const BODY = `
<div class="headline" id="title" aria-live="polite"></div>
<div class="rows"><div class="row" id="facts"></div></div>
<div class="muted" id="origin"></div>
<div class="edits" id="edits" hidden>
  <label class="field">
    <span class="field-label" id="state-label">State</span>
    <select id="state"></select>
  </label>
  <label class="field">
    <span class="field-label">Due</span>
    <input id="due" type="date">
  </label>
</div>
<div class="actions">
  <button id="open" class="quiet" hidden>Open in Docket</button>
</div>`;

const SCRIPT = String.raw`
(() => {
  const el = (id) => document.getElementById(id);
  let entity = null;

  function fact(label, value) {
    const span = document.createElement('span');
    span.className = 'muted';
    span.textContent = label + ': ' + value;
    return span;
  }

  function describeOrigin(origin) {
    if (!origin) {
      return '';
    }
    // The client name when an agent made it, the tool otherwise — "created by capture" means
    // nothing to a person, but "created by Claude" does.
    const who = origin.client || 'an agent';
    const when = origin.at ? new Date(origin.at).toLocaleDateString() : '';
    return 'Created by ' + who + (when ? ' on ' + when : '');
  }

  window.docket.onData((data) => {
    const items = data.items || [];
    entity = items[0] || null;
    if (!entity) {
      el('title').textContent = 'Not found';
      el('facts').replaceChildren();
      el('origin').textContent = 'Nothing here matches that any more.';
      return;
    }

    el('title').textContent = entity.title || entity.name || entity.id;

    // Anything with a control below is not also printed here. A value shown twice reads as two
    // facts, and the moment one of them is a control the other is just the stale copy.
    const editable = ((entity.stateOptions || []).length) > 0;

    const facts = el('facts');
    facts.replaceChildren();
    const state = entity.state || entity.status;
    if (state && !editable) {
      // The glyph carries the canonical type and the text carries the team's own name for it.
      // Both, because "Doing" alone does not say whether the work has started.
      const glyph = window.docket.stateGlyph(entity.stateType);
      if (glyph) {
        facts.appendChild(glyph);
      }
      facts.appendChild(fact('State', window.docket.label(state)));
    }
    if (entity.priority && entity.priority !== 'none') {
      facts.appendChild(fact('Priority', window.docket.label(entity.priority)));
    }
    if (entity.dueDate && !editable) {
      facts.appendChild(fact('Due', window.docket.label(String(entity.dueDate).slice(0, 10))));
    }
    if (Array.isArray(entity.blockedBy) && entity.blockedBy.length > 0) {
      facts.appendChild(fact('Blocked by', String(entity.blockedBy.length)));
    }
    // An empty row would still draw its own tinted background.
    facts.hidden = facts.childElementCount === 0;

    el('origin').textContent = describeOrigin(entity.origin);
    renderEdits();
    el('open').hidden = false;
  });

  function renderEdits() {
    const options = (entity && entity.stateOptions) || [];

    // The glyph moves to sit with the control, so the canonical type stays visible even though
    // the team's own label is what the picker shows.
    const label = el('state-label');
    label.replaceChildren();
    const glyph = window.docket.stateGlyph(entity.stateType);
    if (glyph) {
      label.appendChild(glyph);
    }
    label.appendChild(document.createTextNode('State'));

    const select = el('state');
    select.replaceChildren();
    for (const option of options) {
      const node = document.createElement('option');
      node.value = option.key;
      // The team's own label, because that is the word on their board.
      node.textContent = option.name;
      node.selected = option.key === entity.state;
      select.appendChild(node);
    }
    // No options means the widget was handed a container, or a task whose team it cannot see.
    // Offering an empty picker would be a control that visibly does nothing.
    select.hidden = options.length === 0;
    el('state-label').hidden = options.length === 0;

    const due = el('due');
    due.value = entity.dueDate ? String(entity.dueDate).slice(0, 10) : '';
    el('edits').hidden = options.length === 0 && !('dueDate' in entity);
  }

  /**
   * Apply one field, showing the new value immediately and putting the old one back if the server
   * refuses. A control that waits for a round trip before moving reads as broken on a slow link,
   * and one that moves and stays moved after a failure is worse than either.
   */
  async function edit(control, field, value, previous, describe) {
    control.disabled = true;
    try {
      await window.docket.call('update', {
        orgId: window.docket.input.orgId,
        entity: 'task',
        scope: { ids: [entity.id] },
        set: { [field]: value },
      });
      entity[field] = value;
      window.docket.notice('');
      // Without this the agent goes on answering from the state the card was rendered with.
      await window.docket.tell(describe);
    } catch {
      control.value = previous;
      window.docket.notice('That could not be saved. Open Docket to check it.', 'error');
    } finally {
      control.disabled = false;
    }
  }

  el('state').addEventListener('change', async (event) => {
    if (!entity) {
      return;
    }
    const select = event.target;
    const chosen = (entity.stateOptions || []).find((option) => option.key === select.value);
    await edit(
      select,
      'state',
      select.value,
      entity.state,
      'The user moved "' + (entity.title || entity.id) + '" to ' +
        ((chosen && chosen.name) || select.value) + ' from the card.',
    );
  });

  el('due').addEventListener('change', async (event) => {
    if (!entity) {
      return;
    }
    const input = event.target;
    const previous = entity.dueDate ? String(entity.dueDate).slice(0, 10) : '';
    await edit(
      input,
      'dueDate',
      input.value || null,
      previous,
      input.value
        ? 'The user set the due date of "' + (entity.title || entity.id) + '" to ' + input.value + ' from the card.'
        : 'The user cleared the due date of "' + (entity.title || entity.id) + '" from the card.',
    );
  });

  el('open').addEventListener('click', () => {
    const orgId = window.docket.input.orgId;
    if (entity && orgId) {
      window.docket.link('/orgs/' + orgId + '/tasks/' + entity.id);
    }
  });
})();
`;

/** The rendered entity document. */
export const ENTITY_HTML = appDocument('Entity', BODY, SCRIPT, { skeletonRows: 1 });
